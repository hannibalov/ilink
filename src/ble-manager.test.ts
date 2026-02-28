import { vi } from 'vitest';
import { BLEManager } from './ble-manager';
import { DeviceConfig } from './types';
import { Peripheral } from '@abandonware/noble';
import noble from '@abandonware/noble';

const discoverCallbacks: Function[] = [];

vi.mock('@abandonware/noble', () => {
  const mockNobleInstance: any = {
    on: vi.fn((event: string, callback: Function) => {
      if (event === 'discover') {
        discoverCallbacks.push(callback);
      }
    }),
    startScanning: vi.fn(() => {
      if (mockNobleInstance._triggerDiscover && mockNobleInstance._mockPeripheral) {
        setTimeout(() => {
          discoverCallbacks.forEach((cb) => cb(mockNobleInstance._mockPeripheral));
        }, 50);
      }
    }),
    stopScanningAsync: vi.fn().mockResolvedValue(undefined),
    _state: 'poweredOn',
    _triggerDiscover: false,
    _mockPeripheral: null,
  };

  return {
    __esModule: true,
    default: mockNobleInstance,
  };
});

const mockNoble = noble as any;
(mockNoble as any)._discoverCallbacks = discoverCallbacks;
(mockNoble as any)._triggerDiscover = false;
(mockNoble as any)._mockPeripheral = null;

const mockDeviceInstance = {
  connect: vi.fn().mockResolvedValue(true),
  disconnect: vi.fn().mockResolvedValue(undefined),
  sendCommand: vi.fn().mockResolvedValue(true),
  getState: vi.fn().mockReturnValue({ power: false, brightness: 100 }),
};

vi.mock('./device', () => ({
  ILinkDevice: vi.fn().mockImplementation(() => mockDeviceInstance),
}));

describe('BLEManager', () => {
  let bleManager: BLEManager;
  let stateUpdateCallback: ReturnType<typeof vi.fn>;
  let mockPeripheral: Peripheral;

  beforeEach(() => {
    vi.clearAllMocks();
    discoverCallbacks.length = 0;

    stateUpdateCallback = vi.fn();

    mockPeripheral = {
      id: 'test-id',
      address: 'aa:bb:cc:dd:ee:ff',
      state: 'disconnected',
      connectAsync: vi.fn().mockResolvedValue(undefined),
      disconnectAsync: vi.fn().mockResolvedValue(undefined),
      discoverAllServicesAndCharacteristicsAsync: vi.fn().mockResolvedValue({
        characteristics: [],
      }),
      on: vi.fn(),
      once: vi.fn(),
      advertisement: {
        localName: 'Test Device',
      },
    } as any;

    const callbacks: { [key: string]: Function[] } = {};
    mockNoble.on.mockImplementation((event: string, callback: Function) => {
      if (!callbacks[event]) callbacks[event] = [];
      callbacks[event].push(callback);
      if (event === 'discover') discoverCallbacks.push(callback);
      if (event === 'stateChange' && mockNoble._state === 'poweredOn') {
        setTimeout(() => callback('poweredOn'), 0);
      }
    });
    (mockNoble as any)._callbacks = callbacks;
    mockNoble._state = 'poweredOn';
    (mockNoble as any)._mockPeripheral = mockPeripheral;
    (mockNoble as any)._triggerDiscover = true;

    bleManager = new BLEManager(stateUpdateCallback);
  });

  describe('Initialization', () => {
    it('should initialize when adapter is powered on', async () => {
      mockNoble.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'stateChange' && mockNoble._state === 'poweredOn') {
          setTimeout(() => callback('poweredOn'), 0);
        }
      });
      await expect(bleManager.initialize()).resolves.not.toThrow();
    });

    it('should resolve immediately if already powered on', async () => {
      mockNoble._state = 'poweredOn';
      await expect(bleManager.initialize()).resolves.not.toThrow();
    });

    it('should reject if adapter is unauthorized', async () => {
      mockNoble.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'stateChange') setTimeout(() => callback('unauthorized'), 0);
      });
      await expect(bleManager.initialize()).rejects.toThrow('Bluetooth adapter unauthorized');
    });

    it('should reject if adapter is unsupported', async () => {
      mockNoble.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'stateChange') setTimeout(() => callback('unsupported'), 0);
      });
      await expect(bleManager.initialize()).rejects.toThrow('Bluetooth not supported');
    });
  });

  describe('Device scanning', () => {
    beforeEach(async () => {
      await bleManager.initialize();
    });

    it('should scan for devices', async () => {
      (mockNoble as any)._triggerDiscover = true;
      (mockNoble as any)._mockPeripheral = mockPeripheral;

      const peripherals = await bleManager.scanForDevices(200);

      expect(mockNoble.startScanning).toHaveBeenCalled();
      expect(mockNoble.stopScanningAsync).toHaveBeenCalled();
      expect(peripherals).toBeInstanceOf(Array);
    });

    it('should return empty array if already scanning', async () => {
      bleManager.scanForDevices(1000);
      const result = await bleManager.scanForDevices(100);
      expect(result).toEqual([]);
    });

    it('should collect discovered peripherals', async () => {
      (mockNoble as any)._triggerDiscover = true;
      (mockNoble as any)._mockPeripheral = mockPeripheral;
      mockNoble.startScanning.mockImplementation(() => {
        setTimeout(() => discoverCallbacks.forEach((cb) => cb(mockPeripheral)), 50);
      });

      const result = await bleManager.scanForDevices(200);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('scanForAllDevices (cache only)', () => {
    let deviceConfig: DeviceConfig;

    beforeEach(async () => {
      await bleManager.initialize();
      (mockNoble as any)._triggerDiscover = true;
      (mockNoble as any)._mockPeripheral = mockPeripheral;

      deviceConfig = {
        id: 'test-device',
        name: 'Test Device',
        macAddress: 'aa:bb:cc:dd:ee:ff',
      };
    });

    it('should scan and cache peripherals without connecting', async () => {
      const found = await bleManager.scanForAllDevices([deviceConfig]);

      expect(found.size).toBe(1);
      expect(mockNoble.startScanning).toHaveBeenCalled();
      expect(mockDeviceInstance.connect).not.toHaveBeenCalled();
    });

    it('should find device by MAC address', async () => {
      const found = await bleManager.scanForAllDevices([deviceConfig]);
      expect(found.has(deviceConfig.id)).toBe(true);
    });
  });

  describe('withDevice (short-lived connection)', () => {
    let deviceConfig: DeviceConfig;

    beforeEach(async () => {
      await bleManager.initialize();
      (mockNoble as any)._triggerDiscover = true;
      (mockNoble as any)._mockPeripheral = mockPeripheral;
      await bleManager.scanForAllDevices([
        {
          id: 'test-device',
          name: 'Test Device',
          macAddress: 'aa:bb:cc:dd:ee:ff',
        },
      ]);

      deviceConfig = {
        id: 'test-device',
        name: 'Test Device',
        macAddress: 'aa:bb:cc:dd:ee:ff',
        targetChar: 'a040',
        statusChar: 'a042',
      };
    });

    it('should connect, run fn, then disconnect', async () => {
      const result = await bleManager.withDevice(deviceConfig, async (device) => {
        await device.sendCommand({ state: 'ON' });
        return device.getState();
      });

      expect(mockDeviceInstance.connect).toHaveBeenCalled();
      expect(mockDeviceInstance.disconnect).toHaveBeenCalled();
      expect(mockDeviceInstance.sendCommand).toHaveBeenCalledWith({ state: 'ON' });
      expect(result).toEqual({ power: false, brightness: 100 });
    });

    it('should disconnect even when fn throws', async () => {
      mockDeviceInstance.sendCommand.mockRejectedValueOnce(new Error('write failed'));

      await expect(
        bleManager.withDevice(deviceConfig, async (device) => {
          await device.sendCommand({ state: 'ON' });
        })
      ).rejects.toThrow('write failed');

      expect(mockDeviceInstance.disconnect).toHaveBeenCalled();
    });
  });

  describe('disconnectAll', () => {
    it('should clear peripheral cache', async () => {
      await bleManager.initialize();
      (mockNoble as any)._triggerDiscover = true;
      (mockNoble as any)._mockPeripheral = mockPeripheral;
      await bleManager.scanForAllDevices([
        { id: 'test-device', name: 'Test Device', macAddress: 'aa:bb:cc:dd:ee:ff' },
      ]);

      await bleManager.disconnectAll();

      // Next withDevice for same config would need to find peripheral again (not in cache)
      // We can't easily assert cache is empty; just ensure no throw
      await expect(bleManager.disconnectAll()).resolves.not.toThrow();
    });
  });
});
