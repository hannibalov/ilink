import noble, { Peripheral } from '@abandonware/noble';
import { DeviceConfig } from './types';
import { ILinkDevice } from './device';

const DISCONNECT_DELAY_MS = 300;

/**
 * BLE manager using short-lived connections only.
 * No persistent connections: connect → run fn → disconnect → delay.
 * Use a BleQueue to serialize all BLE operations (one at a time).
 */
export class BLEManager {
  /** Cache of peripherals by device id (from scan only; no connection kept) */
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
   * Scan for all configured devices and cache peripheral references (no connection).
   * Call at startup so withDevice can use the cache and avoid scanning on every command.
   */
  async scanForAllDevices(configs: DeviceConfig[]): Promise<Map<string, Peripheral>> {
    console.log(`[BLE] Scanning for ${configs.length} configured device(s) (no connection)...`);

    if (this.isScanning) {
      await noble.stopScanningAsync();
      this.isScanning = false;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const peripherals = await this.scanForDevices(10000);
    console.log(`[BLE] Found ${peripherals.length} device(s) during scan`);

    const foundPeripherals = new Map<string, Peripheral>();
    const normalizeMac = (mac: string) => mac.toLowerCase().replace(/[:-]/g, '');

    for (const config of configs) {
      const targetMac = normalizeMac(config.macAddress);
      let peripheral = peripherals.find((p) => {
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

      if (!peripheral) {
        peripheral = peripherals.find((p) => {
          const localName = p.advertisement.localName || '';
          if (!localName || localName.trim() === '') return false;
          if (localName.toLowerCase() === config.name.toLowerCase()) return true;
          if (localName.length > 3 && config.name.length > 3) {
            if (
              localName.toLowerCase().includes(config.name.toLowerCase()) ||
              config.name.toLowerCase().includes(localName.toLowerCase())
            )
              return true;
          }
          return false;
        });
      }

      if (!peripheral && config.macAddress.length === 32 && !config.macAddress.includes(':')) {
        peripheral = peripherals.find((p) => p.id === config.macAddress);
      }

      if (!peripheral) {
        const iLinkDevices = peripherals.filter((p) => {
          const serviceUuids = p.advertisement.serviceUuids || [];
          return serviceUuids.some((uuid: string) =>
            uuid.toLowerCase().replace(/-/g, '').includes('a032')
          );
        });
        if (iLinkDevices.length === 1) peripheral = iLinkDevices[0];
      }

      if (peripheral) {
        const rssi = peripheral.rssi !== undefined ? `${peripheral.rssi} dBm` : 'unknown';
        console.log(
          `[BLE] Found ${config.name}: ${peripheral.address || peripheral.id} (RSSI: ${rssi})`
        );
        foundPeripherals.set(config.id, peripheral);
        this.peripherals.set(config.id, peripheral);
      } else {
        console.error(`[BLE] Device ${config.name} (${config.macAddress}) not found during scan`);
      }
    }

    return foundPeripherals;
  }

  /**
   * Run a short-lived BLE session: connect → fn(device) → disconnect → delay.
   * Always disconnects in finally. Call this only from within BleQueue.schedule().
   */
  async withDevice<T>(
    config: DeviceConfig,
    fn: (device: ILinkDevice) => Promise<T>
  ): Promise<T> {
    let peripheral = this.peripherals.get(config.id);
    if (!peripheral) {
      peripheral = await this.findAndCachePeripheral(config);
    }
    if (!peripheral) {
      throw new Error(`Device ${config.name} (${config.macAddress}) not found`);
    }

    const device = new ILinkDevice(config, (state) => {
      this.onDeviceStateUpdate(config.id, state);
    });

    try {
      const connected = await device.connect(peripheral);
      if (!connected) {
        throw new Error(`Failed to connect to ${config.name}`);
      }
      return await fn(device);
    } finally {
      await device.disconnect();
      await new Promise((resolve) => setTimeout(resolve, DISCONNECT_DELAY_MS));
    }
  }

  /**
   * Find a single device by config (scan and cache). Used when cache is empty.
   */
  private async findAndCachePeripheral(config: DeviceConfig): Promise<Peripheral | undefined> {
    if (this.isScanning) {
      await noble.stopScanningAsync();
      this.isScanning = false;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const peripherals = await this.scanForDevices(8000);
    const normalizeMac = (mac: string) => mac.toLowerCase().replace(/[:-]/g, '');
    const targetMac = normalizeMac(config.macAddress);

    let peripheral = peripherals.find((p) => {
      if (p.address && p.address !== 'N/A') {
        if (normalizeMac(p.address) === targetMac) return true;
      }
      if (p.id) {
        if (normalizeMac(p.id) === targetMac || p.id.toLowerCase() === targetMac) return true;
      }
      return false;
    });

    if (!peripheral) {
      peripheral = peripherals.find((p) => {
        const localName = p.advertisement.localName || '';
        return (
          localName &&
          (localName.toLowerCase() === config.name.toLowerCase() ||
            (localName.length > 3 &&
              config.name.length > 3 &&
              (localName.toLowerCase().includes(config.name.toLowerCase()) ||
                config.name.toLowerCase().includes(localName.toLowerCase()))))
        );
      });
    }

    if (!peripheral && config.macAddress.length === 32 && !config.macAddress.includes(':')) {
      peripheral = peripherals.find((p) => p.id === config.macAddress);
    }

    if (!peripheral) {
      const iLinkDevices = peripherals.filter((p) => {
        const serviceUuids = p.advertisement.serviceUuids || [];
        return serviceUuids.some((uuid: string) =>
          uuid.toLowerCase().replace(/-/g, '').includes('a032')
        );
      });
      if (iLinkDevices.length === 1) peripheral = iLinkDevices[0];
    }

    if (peripheral) {
      this.peripherals.set(config.id, peripheral);
    }
    return peripheral;
  }

  /** Clear peripheral cache. No persistent connections to close. */
  async disconnectAll(): Promise<void> {
    this.peripherals.clear();
  }
}
