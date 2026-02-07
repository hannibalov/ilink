import noble, { Peripheral, Characteristic } from '@abandonware/noble';
import { DeviceConfig } from './types';
import { ILinkDevice } from './device';

export class BLEManager {
  private devices = new Map<string, ILinkDevice>();
  private peripherals = new Map<string, Peripheral>();
  private deviceConfigs = new Map<string, DeviceConfig>();
  private isScanning = false;

  constructor(private onDeviceStateUpdate: (deviceId: string, state: any) => void) { }

  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      noble.on('stateChange', async (state) => {
        if (state === 'poweredOn') {
          console.log('[BLE] Adapter powered on');
          resolve();
        } else {
          console.warn(`[BLE] Adapter state: ${state}`);
          if (state === 'unauthorized') {
            reject(new Error('Bluetooth adapter unauthorized'));
          } else if (state === 'unsupported') {
            reject(new Error('Bluetooth not supported'));
          }
        }
      });

      if (noble._state === 'poweredOn') {
        resolve();
      }
    });
  }

  async scanForDevices(duration: number = 10000): Promise<Peripheral[]> {
    if (this.isScanning) {
      console.log('[BLE] Already scanning');
      return [];
    }

    return new Promise((resolve) => {
      const foundPeripherals = new Map<string, Peripheral>();

      noble.on('discover', (peripheral: Peripheral) => {
        const id = peripheral.id || peripheral.address;
        if (!foundPeripherals.has(id)) {
          foundPeripherals.set(id, peripheral);
        }
      });

      noble.startScanning([], true);
      this.isScanning = true;

      setTimeout(async () => {
        await noble.stopScanningAsync();
        this.isScanning = false;
        resolve(Array.from(foundPeripherals.values()));
      }, duration);
    });
  }

  async connectDevice(config: DeviceConfig): Promise<ILinkDevice | null> {
    // CRITICAL FIX FOR RASPBERRY PI: Many Bluetooth adapters cannot scan while connected to BLE devices
    // We need to temporarily disconnect existing connections before scanning for new devices
    // Store device configs for reconnection later
    const existingConnections = Array.from(this.devices.entries());
    const tempDisconnected: Array<{id: string, deviceConfig: DeviceConfig, device: ILinkDevice}> = [];
    
    if (existingConnections.length > 0) {
      console.log(`[BLE] Temporarily disconnecting ${existingConnections.length} device(s) to allow scanning for ${config.name}...`);
      // Store device configs before disconnecting (we'll need them for reconnection)
      for (const [deviceId, device] of existingConnections) {
        if (device.isConnected()) {
          // Get the device config - we'll need it for reconnection
          const deviceConfig = this.deviceConfigs.get(deviceId);
          if (deviceConfig) {
            try {
              await device.disconnect();
              tempDisconnected.push({id: deviceId, deviceConfig, device});
              console.log(`[BLE] Temporarily disconnected ${deviceId}`);
            } catch (error) {
              console.warn(`[BLE] Error disconnecting ${deviceId}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        }
      }
      // Wait for disconnections to complete
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Stop scanning if active (required by noble before connecting)
    if (this.isScanning) {
      console.log(`[BLE] Stopping scan before connecting to ${config.name}...`);
      await noble.stopScanningAsync();
      this.isScanning = false;
      // Wait a bit for scan to fully stop
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Find the device by scanning
    console.log(`[BLE] Scanning for ${config.name} (${config.macAddress})...`);
    const peripherals = await this.scanForDevices(8000);
    console.log(`[BLE] Found ${peripherals.length} device(s) during scan`);
    let peripheral: Peripheral | undefined;

    // Try to find by MAC address first
    const normalizeMac = (mac: string) => mac.toLowerCase().replace(/[:-]/g, '');
    const targetMac = normalizeMac(config.macAddress);

    peripheral = peripherals.find(p => {
      // Try address first (actual MAC address - works on Linux)
      if (p.address && p.address !== 'N/A') {
        const normalizedAddress = normalizeMac(p.address);
        if (normalizedAddress === targetMac) {
          return true;
        }
      }

      // Fallback: try id (might be MAC on some platforms)
      if (p.id) {
        const normalizedId = normalizeMac(p.id);
        if (normalizedId === targetMac || p.id.toLowerCase() === targetMac) {
          return true;
        }
      }

      return false;
    });

    // If MAC address matching failed, try matching by device name
    if (!peripheral) {
      peripheral = peripherals.find(p => {
        const localName = p.advertisement.localName || '';
        if (!localName || localName.trim() === '') {
          return false;
        }
        if (localName.toLowerCase() === config.name.toLowerCase()) {
          return true;
        }
        if (localName.length > 3 && config.name.length > 3) {
          if (localName.toLowerCase().includes(config.name.toLowerCase()) ||
            config.name.toLowerCase().includes(localName.toLowerCase())) {
            return true;
          }
        }
        return false;
      });
    }

    // If still not found, try matching by device ID (useful on macOS)
    if (!peripheral && config.macAddress.length === 32 && !config.macAddress.includes(':')) {
      peripheral = peripherals.find(p => p.id === config.macAddress);
    }

    // Last resort: try to find iLink devices by service UUID (a032)
    if (!peripheral) {
      const iLinkDevices = peripherals.filter(p => {
        const serviceUuids = p.advertisement.serviceUuids || [];
        return serviceUuids.some((uuid: string) =>
          uuid.toLowerCase().replace(/-/g, '').includes('a032')
        );
      });

      if (iLinkDevices.length === 1) {
        peripheral = iLinkDevices[0];
      } else if (iLinkDevices.length > 0) {
        console.warn(`[BLE] Found ${iLinkDevices.length} iLink devices. Please run 'yarn scan' to identify device IDs.`);
      }
    }

    if (!peripheral) {
      console.error(`[BLE] Device ${config.name} (${config.macAddress}) not found during scan`);
      console.error(`[BLE] Available devices:`, peripherals.map(p => {
        const name = p.advertisement.localName || 'Unknown';
        const address = p.address || 'N/A';
        const rssi = p.rssi !== undefined ? `${p.rssi} dBm` : 'unknown';
        return `${name} (${address}, RSSI: ${rssi})`;
      }).join(', '));
      console.error(`[BLE] Run 'sudo yarn scan' to identify device IDs`);
      return null;
    }
    
    // Log successful device discovery
    const rssi = peripheral.rssi !== undefined ? `${peripheral.rssi} dBm` : 'unknown';
    console.log(`[BLE] Found ${config.name}: ${peripheral.address || peripheral.id} (RSSI: ${rssi})`);

    // Connect with retry logic for Raspberry Pi
    // On Raspberry Pi, BLE connections can be fragile and may need multiple attempts
    const maxConnectionAttempts = 3;
    let device: ILinkDevice | null = null;
    
    for (let attempt = 1; attempt <= maxConnectionAttempts; attempt++) {
      try {
        // Get fresh peripheral reference if needed (for retries)
        if (attempt > 1) {
          console.log(`[BLE] Retry attempt ${attempt}/${maxConnectionAttempts} for ${config.name}...`);
          
          // Clean up previous attempt
          if (device) {
            try {
              await device.disconnect();
            } catch (disconnectError) {
              // Ignore disconnect errors
            }
            device = null;
          }
          
          // Wait before retry to let Bluetooth stack stabilize
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Re-scan to get a fresh peripheral reference
          const freshPeripherals = await this.scanForDevices(8000);
          
          // Find the device again using the same logic as initial scan
          const normalizeMac = (mac: string) => mac.toLowerCase().replace(/[:-]/g, '');
          const targetMac = normalizeMac(config.macAddress);
          
          let freshPeripheral = freshPeripherals.find(p => {
            if (p.address && p.address !== 'N/A') {
              const normalizedAddress = normalizeMac(p.address);
              if (normalizedAddress === targetMac) {
                return true;
              }
            }
            if (p.id) {
              const normalizedId = normalizeMac(p.id);
              if (normalizedId === targetMac || p.id.toLowerCase() === targetMac) {
                return true;
              }
            }
            return false;
          });
          
          if (!freshPeripheral) {
            // Try by name
            freshPeripheral = freshPeripherals.find(p => {
              const localName = p.advertisement.localName || '';
              return localName.toLowerCase() === config.name.toLowerCase() ||
                     (localName.length > 3 && config.name.length > 3 &&
                      (localName.toLowerCase().includes(config.name.toLowerCase()) ||
                       config.name.toLowerCase().includes(localName.toLowerCase())));
            });
          }
          
          if (!freshPeripheral) {
            throw new Error(`Device ${config.name} not found during retry scan`);
          }
          
          peripheral = freshPeripheral;
        }
        
        // Store peripheral reference to prevent garbage collection
        this.peripherals.set(config.id, peripheral);

        // Create device instance (or recreate for retries)
        if (!device) {
          device = new ILinkDevice(config, (state) => {
            this.onDeviceStateUpdate(config.id, state);
          });
        }
        
        const connected = await device.connect(peripheral);
        if (connected) {
          this.devices.set(config.id, device);
          this.deviceConfigs.set(config.id, config);
          console.log(`[BLE] Successfully connected to ${config.name} on attempt ${attempt}`);
          
          // Reconnect temporarily disconnected devices
          if (tempDisconnected.length > 0) {
            console.log(`[BLE] Reconnecting ${tempDisconnected.length} temporarily disconnected device(s)...`);
            for (const {id, deviceConfig: tempConfig, device: tempDevice} of tempDisconnected) {
              try {
                // Need to re-scan to get a fresh peripheral reference for reconnection
                console.log(`[BLE] Scanning to reconnect ${tempConfig.name}...`);
                const reconnectPeripherals = await this.scanForDevices(8000);
                const normalizeMac = (mac: string) => mac.toLowerCase().replace(/[:-]/g, '');
                const targetMac = normalizeMac(tempConfig.macAddress);
                
                let reconnectPeripheral = reconnectPeripherals.find(p => {
                  if (p.address && p.address !== 'N/A') {
                    const normalizedAddress = normalizeMac(p.address);
                    if (normalizedAddress === targetMac) return true;
                  }
                  if (p.id) {
                    const normalizedId = normalizeMac(p.id);
                    if (normalizedId === targetMac || p.id.toLowerCase() === targetMac) return true;
                  }
                  return false;
                });
                
                if (!reconnectPeripheral) {
                  // Try by name
                  reconnectPeripheral = reconnectPeripherals.find(p => {
                    const localName = p.advertisement.localName || '';
                    return localName.toLowerCase() === tempConfig.name.toLowerCase();
                  });
                }
                
                if (reconnectPeripheral) {
                  console.log(`[BLE] Reconnecting ${tempConfig.name}...`);
                  this.peripherals.set(id, reconnectPeripheral);
                  await tempDevice.connect(reconnectPeripheral);
                  this.devices.set(id, tempDevice);
                  console.log(`[BLE] Successfully reconnected ${tempConfig.name}`);
                  // Small delay between reconnections
                  await new Promise(resolve => setTimeout(resolve, 2000));
                } else {
                  console.error(`[BLE] Could not find ${tempConfig.name} during reconnection scan`);
                }
              } catch (reconnectError) {
                console.error(`[BLE] Failed to reconnect ${tempConfig.name}: ${reconnectError instanceof Error ? reconnectError.message : String(reconnectError)}`);
                // Remove from devices map if reconnection failed
                this.devices.delete(id);
                this.peripherals.delete(id);
                this.deviceConfigs.delete(id);
              }
            }
          }
          
          return device;
        } else {
          // Connection failed - will retry if attempts remain
          if (attempt < maxConnectionAttempts) {
            console.log(`[BLE] Connection to ${config.name} returned false, will retry...`);
            continue;
          }
          break;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // Check if this is a recoverable error (disconnection, need fresh reference)
        const isRecoverable = errorMessage.includes('need fresh reference') || 
                              errorMessage.includes('disconnected') ||
                              errorMessage.includes('timeout');
        
        if (isRecoverable && attempt < maxConnectionAttempts) {
          console.log(`[BLE] Connection failed (attempt ${attempt}/${maxConnectionAttempts}): ${errorMessage}`);
          // Will retry on next iteration
          continue;
        }
        
        // For non-recoverable errors or last attempt, fail
        console.error(`[BLE] Failed to connect to ${config.name} after ${attempt} attempt(s): ${errorMessage}`);
        this.peripherals.delete(config.id);
        return null;
      }
    }
    
    // If we get here, connection failed after all attempts
    this.peripherals.delete(config.id);
    return null;
  }

  async disconnectDevice(deviceId: string): Promise<void> {
    const device = this.devices.get(deviceId);
    if (device) {
      await device.disconnect();
      this.devices.delete(deviceId);
      this.peripherals.delete(deviceId);
      this.deviceConfigs.delete(deviceId);
    }
  }

  getDevice(deviceId: string): ILinkDevice | undefined {
    return this.devices.get(deviceId);
  }

  async disconnectAll(): Promise<void> {
    for (const [deviceId, device] of this.devices) {
      await device.disconnect();
    }
    this.devices.clear();
    this.peripherals.clear();
    this.deviceConfigs.clear();
  }
}
