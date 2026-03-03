import noble, { Peripheral } from '@abandonware/noble';
import { DeviceConfig } from './types';
import { ILinkDevice } from './device';

const DISCONNECT_DELAY_MS = 300;
const FIND_AND_CONNECT_TIMEOUT_MS = 10000;

const normalizeMac = (mac: string) => mac.toLowerCase().replace(/[:-]/g, '');

/**
 * Find a device by MAC with a fresh scan and connect. Peripheral MUST come from
 * the same scan session used for connection (noble/BlueZ requirement). Do not cache
 * or reuse Peripheral instances across scans.
 */
export async function findAndConnect(mac: string): Promise<Peripheral> {
  const targetMac = normalizeMac(mac);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(async () => {
      noble.removeListener('discover', onDiscover);
      await noble.stopScanningAsync();
      reject(new Error('Device not found during scan'));
    }, FIND_AND_CONNECT_TIMEOUT_MS);

    const onDiscover = async (peripheral: Peripheral) => {
      const pMac =
        peripheral.address && peripheral.address !== 'N/A'
          ? normalizeMac(peripheral.address)
          : peripheral.id
            ? normalizeMac(peripheral.id)
            : '';
      if (pMac && pMac === targetMac) {
        clearTimeout(timeout);
        noble.removeListener('discover', onDiscover);
        await noble.stopScanningAsync();

        try {
          await peripheral.connectAsync();
          resolve(peripheral);
        } catch (err) {
          reject(err);
        }
      }
    };

    noble.on('discover', onDiscover);
    noble.startScanning([], false);
  });
}

/**
 * BLE manager using short-lived connections only.
 * No persistent connections: connect → run fn → disconnect → delay.
 * Use a BleQueue to serialize all BLE operations (one at a time).
 * Does NOT cache Peripheral instances; each command uses a fresh scan + connect.
 */
export class BLEManager {
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
   * Scan for all configured devices for visibility/logging only. Does NOT cache
   * Peripheral instances. Only use scan results for logging/MAC verification.
   * withDevice always uses a fresh scan per command (findAndConnect).
   */
  async scanForAllDevices(configs: DeviceConfig[]): Promise<Map<string, boolean>> {
    console.log(`[BLE] Scanning for ${configs.length} configured device(s) (no connection)...`);

    if (this.isScanning) {
      await noble.stopScanningAsync();
      this.isScanning = false;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const peripherals = await this.scanForDevices(10000);
    console.log(`[BLE] Found ${peripherals.length} device(s) during scan`);

    const foundById = new Map<string, boolean>();

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
        foundById.set(config.id, true);
      } else {
        console.error(`[BLE] Device ${config.name} (${config.macAddress}) not found during scan`);
      }
    }

    return foundById;
  }

  /**
   * Run a short-lived BLE session: fresh scan → connect → fn(device) → disconnect → delay.
   * Always uses findAndConnect (no cached Peripheral). Call only from within BleQueue.schedule().
   */
  async withDevice<T>(
    config: DeviceConfig,
    fn: (device: ILinkDevice) => Promise<T>
  ): Promise<T> {
    const peripheral = await findAndConnect(config.macAddress);

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

  /** No-op: no peripheral cache. Kept for API compatibility. */
  async disconnectAll(): Promise<void> {
    // No persistent connections or cached peripherals to clear.
  }
}
