/**
 * Alternative BLE Manager implementation using node-ble library
 * This uses D-Bus directly for better BlueZ integration and concurrent connection support
 * 
 * To use this instead of the noble-based implementation:
 * 1. Install: npm install node-ble
 * 2. Update index.ts to import from './ble-manager-nodeble' instead of './ble-manager'
 * 3. Test concurrent connections
 * 
 * Note: This is an experimental implementation for testing concurrent connections
 */

import { createBluetooth } from 'node-ble';
import { DeviceConfig } from './types';
import { ILinkDeviceNodeBle } from './device-nodeble';

export class BLEManagerNodeBle {
  private bluetooth: ReturnType<typeof createBluetooth> | null = null;
  private adapter: any = null;
  private devices = new Map<string, ILinkDeviceNodeBle>();
  private deviceConfigs = new Map<string, DeviceConfig>();
  private isScanning = false;

  constructor(private onDeviceStateUpdate: (deviceId: string, state: any) => void) {}

  async initialize(): Promise<void> {
    try {
      console.log('[BLE-NodeBle] Initializing node-ble...');
      this.bluetooth = createBluetooth();
      this.adapter = await this.bluetooth.defaultAdapter();
      
      // Wait for adapter to be ready
      await this.adapter.waitUntilReady();
      console.log('[BLE-NodeBle] Adapter ready');
      
      // Power on adapter
      await this.adapter.setPowered(true);
      console.log('[BLE-NodeBle] Adapter powered on');
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[BLE-NodeBle] Failed to initialize:', errorMessage);
      throw new Error(`Failed to initialize BLE adapter: ${errorMessage}`);
    }
  }

  async scanForAllDevices(configs: DeviceConfig[]): Promise<Map<string, any>> {
    if (!this.adapter) {
      throw new Error('Adapter not initialized');
    }

    console.log(`[BLE-NodeBle] Scanning for ${configs.length} configured device(s)...`);
    
    const foundDevices = new Map<string, any>();
    const normalizeMac = (mac: string) => mac.toLowerCase().replace(/[:-]/g, '');

    try {
      // Start scanning
      await this.adapter.startScan();
      this.isScanning = true;
      console.log('[BLE-NodeBle] Scan started');

      // Collect devices for 10 seconds
      const scanDuration = 10000;
      const startTime = Date.now();
      const discoveredDevices = new Map<string, any>();

      // Listen for discovered devices
      this.adapter.on('device', (device: any) => {
        try {
          const address = device.getAddress?.() || device.address;
          if (address) {
            discoveredDevices.set(address.toLowerCase(), device);
          }
        } catch (err) {
          // Ignore errors during discovery
        }
      });

      // Wait for scan duration
      await new Promise(resolve => setTimeout(resolve, scanDuration));

      // Stop scanning
      await this.adapter.stopScan();
      this.isScanning = false;
      console.log(`[BLE-NodeBle] Scan stopped. Found ${discoveredDevices.size} device(s)`);

      // Match discovered devices with configs
      for (const config of configs) {
        const targetMac = normalizeMac(config.macAddress);
        let matchedDevice: any = null;

        // Try to find by MAC address
        for (const [address, device] of discoveredDevices) {
          const normalizedAddress = normalizeMac(address);
          if (normalizedAddress === targetMac) {
            matchedDevice = device;
            break;
          }
        }

        // Try to find by name if MAC didn't match
        if (!matchedDevice) {
          for (const [address, device] of discoveredDevices) {
            try {
              const name = device.getName?.() || device.name || '';
              if (name.toLowerCase() === config.name.toLowerCase()) {
                matchedDevice = device;
                break;
              }
            } catch (err) {
              // Ignore errors
            }
          }
        }

        if (matchedDevice) {
          foundDevices.set(config.id, matchedDevice);
          console.log(`[BLE-NodeBle] Found ${config.name}: ${targetMac}`);
        } else {
          console.error(`[BLE-NodeBle] Device ${config.name} (${config.macAddress}) not found during scan`);
        }
      }

    } catch (error) {
      this.isScanning = false;
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[BLE-NodeBle] Scan error:', errorMessage);
      throw error;
    }

    return foundDevices;
  }

  async connectDevice(config: DeviceConfig, device: any): Promise<ILinkDeviceNodeBle | null> {
    if (!device) {
      console.error(`[BLE-NodeBle] No device provided for ${config.name}`);
      return null;
    }

    try {
      console.log(`[BLE-NodeBle] Connecting to ${config.name}...`);
      
      // Create device instance
      const iLinkDevice = new ILinkDeviceNodeBle(config, (state) => {
        this.onDeviceStateUpdate(config.id, state);
      });

      // Connect using node-ble
      const connected = await iLinkDevice.connect(device);
      
      if (connected) {
        this.devices.set(config.id, iLinkDevice);
        this.deviceConfigs.set(config.id, config);
        console.log(`[BLE-NodeBle] Successfully connected to ${config.name}`);
        return iLinkDevice;
      } else {
        console.error(`[BLE-NodeBle] Connection to ${config.name} returned false`);
        return null;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[BLE-NodeBle] Failed to connect to ${config.name}: ${errorMessage}`);
      return null;
    }
  }

  async disconnectDevice(deviceId: string): Promise<void> {
    const device = this.devices.get(deviceId);
    if (device) {
      await device.disconnect();
      this.devices.delete(deviceId);
      this.deviceConfigs.delete(deviceId);
    }
  }

  getDevice(deviceId: string): ILinkDeviceNodeBle | undefined {
    return this.devices.get(deviceId);
  }

  async disconnectAll(): Promise<void> {
    for (const [deviceId, device] of this.devices) {
      await device.disconnect();
    }
    this.devices.clear();
    this.deviceConfigs.clear();
  }
}
