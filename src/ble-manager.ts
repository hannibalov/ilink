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
    // First, try to find the device by scanning
    console.log(`[BLE] Looking for device ${config.name} (${config.macAddress})`);
    
    const peripherals = await this.scanForDevices(5000);
    let peripheral: Peripheral | undefined;

    // Try to find by MAC address or ID
    peripheral = peripherals.find(p => {
      const id = p.id || p.address;
      return id.toLowerCase() === config.macAddress.toLowerCase() ||
             id.toLowerCase().replace(/:/g, '') === config.macAddress.toLowerCase().replace(/:/g, '');
    });

    if (!peripheral) {
      console.error(`[BLE] Device ${config.macAddress} not found in scan results`);
      return null;
    }

    console.log(`[BLE] Found peripheral for ${config.name}, attempting connection...`);

    // Create device instance
    const device = new ILinkDevice(config, (state) => {
      this.onDeviceStateUpdate(config.id, state);
    });

    // Connect
    const connected = await device.connect(peripheral);
    if (connected) {
      console.log(`[BLE] Successfully connected and registered ${config.name} (${config.id})`);
      this.devices.set(config.id, device);
      this.peripherals.set(config.id, peripheral);
      return device;
    } else {
      console.error(`[BLE] Failed to connect to ${config.name} - connection returned false`);
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
