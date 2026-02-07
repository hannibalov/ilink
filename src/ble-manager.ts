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

  /**
   * Scan for all configured devices upfront and store peripheral references.
   * This avoids the need to scan while connected (which Raspberry Pi adapters can't do).
   */
  async scanForAllDevices(configs: DeviceConfig[]): Promise<Map<string, Peripheral>> {
    console.log(`[BLE] Scanning for ${configs.length} configured device(s)...`);
    
    // Stop scanning if active
    if (this.isScanning) {
      await noble.stopScanningAsync();
      this.isScanning = false;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    const peripherals = await this.scanForDevices(10000); // 10 second scan
    console.log(`[BLE] Found ${peripherals.length} device(s) during scan`);
    
    const foundPeripherals = new Map<string, Peripheral>();
    const normalizeMac = (mac: string) => mac.toLowerCase().replace(/[:-]/g, '');
    
    for (const config of configs) {
      const targetMac = normalizeMac(config.macAddress);
      let peripheral = peripherals.find(p => {
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
        }
      }
      
      if (peripheral) {
        const rssi = peripheral.rssi !== undefined ? `${peripheral.rssi} dBm` : 'unknown';
        console.log(`[BLE] Found ${config.name}: ${peripheral.address || peripheral.id} (RSSI: ${rssi})`);
        foundPeripherals.set(config.id, peripheral);
        this.peripherals.set(config.id, peripheral);
        this.deviceConfigs.set(config.id, config);
      } else {
        console.error(`[BLE] Device ${config.name} (${config.macAddress}) not found during scan`);
      }
    }
    
    return foundPeripherals;
  }

  async connectDevice(config: DeviceConfig, peripheral?: Peripheral): Promise<ILinkDevice | null> {
    // If peripheral is provided (from upfront scan), use it directly - no scanning needed!
    // This avoids the Raspberry Pi limitation of not being able to scan while connected
    let targetPeripheral: Peripheral | undefined = peripheral;
    
    // If no peripheral provided, we need to scan (but this shouldn't happen in normal flow)
    if (!targetPeripheral) {
      console.warn(`[BLE] No peripheral provided for ${config.name}, scanning...`);
      
      // Stop scanning if active (required by noble before connecting)
      if (this.isScanning) {
        console.log(`[BLE] Stopping scan before connecting to ${config.name}...`);
        await noble.stopScanningAsync();
        this.isScanning = false;
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Find the device by scanning
      console.log(`[BLE] Scanning for ${config.name} (${config.macAddress})...`);
      const peripherals = await this.scanForDevices(8000);
      console.log(`[BLE] Found ${peripherals.length} device(s) during scan`);
      
      const normalizeMac = (mac: string) => mac.toLowerCase().replace(/[:-]/g, '');
      const targetMac = normalizeMac(config.macAddress);

      targetPeripheral = peripherals.find(p => {
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

      // If MAC address matching failed, try matching by device name
      if (!targetPeripheral) {
        targetPeripheral = peripherals.find(p => {
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
      if (!targetPeripheral && config.macAddress.length === 32 && !config.macAddress.includes(':')) {
        targetPeripheral = peripherals.find(p => p.id === config.macAddress);
      }

      // Last resort: try to find iLink devices by service UUID (a032)
      if (!targetPeripheral) {
        const iLinkDevices = peripherals.filter(p => {
          const serviceUuids = p.advertisement.serviceUuids || [];
          return serviceUuids.some((uuid: string) =>
            uuid.toLowerCase().replace(/-/g, '').includes('a032')
          );
        });

        if (iLinkDevices.length === 1) {
          targetPeripheral = iLinkDevices[0];
        } else if (iLinkDevices.length > 0) {
          console.warn(`[BLE] Found ${iLinkDevices.length} iLink devices. Please run 'yarn scan' to identify device IDs.`);
        }
      }
    }
    
    if (!targetPeripheral) {
      console.error(`[BLE] Device ${config.name} (${config.macAddress}) not found`);
      console.error(`[BLE] Run 'sudo yarn scan' to identify device IDs`);
      return null;
    }
    
    // Log successful device discovery
    const rssi = targetPeripheral.rssi !== undefined ? `${targetPeripheral.rssi} dBm` : 'unknown';
    console.log(`[BLE] Using peripheral for ${config.name}: ${targetPeripheral.address || targetPeripheral.id} (RSSI: ${rssi})`);
    
    let peripheral: Peripheral = targetPeripheral;
      console.error(`[BLE] Device ${config.name} (${config.macAddress}) not found`);
      if (typeof peripherals !== 'undefined') {
        console.error(`[BLE] Available devices:`, peripherals.map(p => {
          const name = p.advertisement.localName || 'Unknown';
          const address = p.address || 'N/A';
          const rssi = p.rssi !== undefined ? `${p.rssi} dBm` : 'unknown';
          return `${name} (${address}, RSSI: ${rssi})`;
        }).join(', '));
      }
      console.error(`[BLE] Run 'sudo yarn scan' to identify device IDs`);
      return null;
    }
    
    // Log successful device discovery
    const rssi = targetPeripheral.rssi !== undefined ? `${targetPeripheral.rssi} dBm` : 'unknown';
    console.log(`[BLE] Using peripheral for ${config.name}: ${targetPeripheral.address || targetPeripheral.id} (RSSI: ${rssi})`);
    
    let peripheral: Peripheral = targetPeripheral;

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
          
          targetPeripheral = freshPeripheral; // Update targetPeripheral for retries
        }
        
        // Use the current peripheral (either from parameter or retry)
        peripheral = targetPeripheral!;
        
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
