import noble, { Peripheral, Characteristic } from '@abandonware/noble';
import { DeviceConfig } from './types';
import { ILinkDevice } from './device';

export class BLEManager {
  private devices = new Map<string, ILinkDevice>();
  private peripherals = new Map<string, Peripheral>();
  private isScanning = false;

  constructor(private onDeviceStateUpdate: (deviceId: string, state: any) => void) {}

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
          console.log(`[BLE] Found device: ${peripheral.advertisement.localName || 'Unknown'} (${id})`);
        }
      });

      noble.startScanning([], true);
      this.isScanning = true;

      setTimeout(async () => {
        await noble.stopScanningAsync();
        this.isScanning = false;
        console.log(`[BLE] Scan complete. Found ${foundPeripherals.size} devices`);
        resolve(Array.from(foundPeripherals.values()));
      }, duration);
    });
  }

  async connectDevice(config: DeviceConfig): Promise<ILinkDevice | null> {
    // Stop scanning if active (required by noble before connecting)
    if (this.isScanning) {
      console.log(`[BLE] Stopping scan before connecting to ${config.name}...`);
      await noble.stopScanningAsync();
      this.isScanning = false;
      // Wait a bit for scan to fully stop
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // First, try to find the device by scanning
    console.log(`[BLE] Looking for device ${config.name} (${config.macAddress})`);
    
    const peripherals = await this.scanForDevices(5000);
    let peripheral: Peripheral | undefined;

    // Try to find by MAC address first
    // On macOS, peripheral.address is often N/A due to privacy, so we fall back to name matching
    const normalizeMac = (mac: string) => mac.toLowerCase().replace(/[:-]/g, '');
    const targetMac = normalizeMac(config.macAddress);
    
    peripheral = peripherals.find(p => {
      // Try address first (actual MAC address - works on Linux)
      if (p.address && p.address !== 'N/A') {
        const normalizedAddress = normalizeMac(p.address);
        if (normalizedAddress === targetMac) {
          console.log(`[BLE] Matched by address: ${p.address} (normalized: ${normalizedAddress})`);
          return true;
        }
      }
      
      // Fallback: try id (might be MAC on some platforms)
      if (p.id) {
        const normalizedId = normalizeMac(p.id);
        if (normalizedId === targetMac) {
          console.log(`[BLE] Matched by id: ${p.id} (normalized: ${normalizedId})`);
          return true;
        }
      }
      
      return false;
    });

    // If MAC address matching failed (common on macOS), try matching by device name
    if (!peripheral) {
      console.log(`[BLE] MAC address matching failed, trying to match by device name: "${config.name}"`);
      
      // First, prioritize devices named "ilink app" (common name for iLink lights)
      const iLinkAppDevices = peripherals.filter(p => {
        const localName = (p.advertisement.localName || '').toLowerCase();
        return localName === 'ilink app' || localName.includes('ilink');
      });
      
      if (iLinkAppDevices.length > 0) {
        console.log(`[BLE] Found ${iLinkAppDevices.length} device(s) named "ilink app"`);
        // For now, we'll need device IDs in config to distinguish them
        // But let's try matching by checking if we can connect and verify characteristics
      }
      
      // Try exact name match (must have a non-empty name)
      peripheral = peripherals.find(p => {
        const localName = p.advertisement.localName || '';
        if (!localName || localName.trim() === '') {
          return false; // Don't match devices with no name
        }
        // Try exact match first
        if (localName.toLowerCase() === config.name.toLowerCase()) {
          console.log(`[BLE] Matched by exact name: "${localName}"`);
          return true;
        }
        // Try partial match only if both names are substantial
        if (localName.length > 3 && config.name.length > 3) {
          if (localName.toLowerCase().includes(config.name.toLowerCase()) || 
              config.name.toLowerCase().includes(localName.toLowerCase())) {
            console.log(`[BLE] Matched by partial name: "${localName}" contains "${config.name}"`);
            return true;
          }
        }
        return false;
      });
    }

    // If still not found, try matching by device ID (useful on macOS)
    // Allow macAddress to be a device ID hash for macOS compatibility
    if (!peripheral && config.macAddress.length === 32 && !config.macAddress.includes(':')) {
      // Looks like a device ID hash (32 hex chars, no colons)
      console.log(`[BLE] Trying to match by device ID: ${config.macAddress}`);
      peripheral = peripherals.find(p => p.id === config.macAddress);
      if (peripheral) {
        console.log(`[BLE] Matched by device ID: ${peripheral.id}`);
      }
    }

    // Last resort: try to find iLink devices by service UUID (a032)
    // This is useful on macOS where MAC addresses aren't available
    if (!peripheral) {
      console.log(`[BLE] All matching methods failed. Looking for iLink devices by service UUID...`);
      const iLinkDevices = peripherals.filter(p => {
        const serviceUuids = p.advertisement.serviceUuids || [];
        return serviceUuids.some((uuid: string) => 
          uuid.toLowerCase().replace(/-/g, '').includes('a032')
        );
      });
      
      if (iLinkDevices.length > 0) {
        console.log(`[BLE] Found ${iLinkDevices.length} potential iLink device(s) by service UUID`);
        console.log(`[BLE] iLink devices found:`);
        iLinkDevices.forEach((p, idx) => {
          console.log(`[BLE]   ${idx + 1}. ${p.advertisement.localName || 'Unknown'} (ID: ${p.id})`);
        });
        console.warn(`[BLE] Cannot automatically match device. Please run 'yarn scan' to find device IDs.`);
        console.warn(`[BLE] Then update your .env DEVICES config to use device IDs instead of MAC addresses for macOS.`);
        console.warn(`[BLE] Example: "macAddress": "${iLinkDevices[0].id}" (use the device ID as the macAddress value)`);
      }
    }

    if (!peripheral) {
      console.error(`[BLE] Device ${config.name} (${config.macAddress}) not found in scan results`);
      console.error(`[BLE] Available devices:`);
      peripherals.forEach(p => {
        console.error(`[BLE]   - ${p.advertisement.localName || 'Unknown'}: id=${p.id}, address=${p.address || 'N/A'}`);
      });
      console.error(`[BLE] Note: On macOS, MAC addresses are not available. Try matching by device name or use the scan script to find device IDs.`);
      return null;
    }

    console.log(`[BLE] Found peripheral for ${config.name}, attempting connection...`);
    console.log(`[BLE] Peripheral ID: ${peripheral.id}, State: ${peripheral.state}`);

    // Store peripheral reference immediately to prevent garbage collection
    this.peripherals.set(config.id, peripheral);

    // Create device instance
    const device = new ILinkDevice(config, (state) => {
      this.onDeviceStateUpdate(config.id, state);
    });

    // Connect
    const connected = await device.connect(peripheral);
    if (connected) {
      console.log(`[BLE] Successfully connected and registered ${config.name} (${config.id})`);
      this.devices.set(config.id, device);
      // Peripheral already stored above
      return device;
    } else {
      console.error(`[BLE] Failed to connect to ${config.name} - connection returned false`);
      this.peripherals.delete(config.id);
      return null;
    }
  }

  async disconnectDevice(deviceId: string): Promise<void> {
    const device = this.devices.get(deviceId);
    if (device) {
      await device.disconnect();
      this.devices.delete(deviceId);
      this.peripherals.delete(deviceId);
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
  }
}
