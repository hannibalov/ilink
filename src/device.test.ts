import { vi } from 'vitest';
import { ILinkDevice } from './device';
import { DeviceConfig, MQTTCommand, LightState } from './types';
import { Peripheral, Characteristic } from '@abandonware/noble';

// Mock the encoding module
vi.mock('./encoding', () => ({
  encodeILinkCommand: vi.fn((cid: string, data: string) => {
    // Simple mock that returns predictable values for testing
    if (cid === '0805' && data === '01') return '55aa01080501f1';
    if (cid === '0805' && data === '00') return '55aa01080500f2';
    if (cid === '0802' && data === 'ff0000') return '55aa030802ff0000f4';
    if (cid === '0801' && data === 'ff') return '55aa010801fff7';
    return `55aa${data.length.toString(16).padStart(2, '0')}${cid}${data}00`;
  }),
  parseILinkStatus: vi.fn((hex: string) => {
    if (hex.includes('0805') && hex.includes('01')) return { power: true };
    if (hex.includes('0805') && hex.includes('00')) return { power: false };
    if (hex.includes('0802')) {
      return { power: true, color: { r: 255, g: 0, b: 0 } };
    }
    return {};
  }),
}));

describe('ILinkDevice', () => {
  let mockPeripheral: Peripheral;
  let mockCharacteristic: Characteristic;
  let mockStatusCharacteristic: Characteristic;
  let deviceConfig: DeviceConfig;
  let stateUpdateCallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create mock characteristic
    mockCharacteristic = {
      uuid: 'a040',
      properties: ['write', 'writeWithoutResponse'],
      writeAsync: vi.fn().mockResolvedValue(undefined),
      readAsync: vi.fn().mockResolvedValue(Buffer.from('')),
    } as any;

    mockStatusCharacteristic = {
      uuid: 'a042',
      properties: ['read'],
      readAsync: vi.fn().mockResolvedValue(Buffer.from('55aa01080501f1', 'hex')),
    } as any;

    // Create mock peripheral
    mockPeripheral = {
      id: 'test-id',
      address: 'aa:bb:cc:dd:ee:ff',
      state: 'disconnected',
      connectAsync: vi.fn().mockImplementation(async () => {
        mockPeripheral.state = 'connected';
        return undefined;
      }),
      disconnectAsync: vi.fn().mockResolvedValue(undefined),
      discoverAllServicesAndCharacteristicsAsync: vi.fn().mockResolvedValue({
        characteristics: [mockCharacteristic, mockStatusCharacteristic],
      }),
      on: vi.fn(),
      once: vi.fn(),
    } as any;

    deviceConfig = {
      id: 'test-device',
      name: 'Test Device',
      macAddress: 'aa:bb:cc:dd:ee:ff',
      targetChar: 'a040',
      statusChar: 'a042',
    };

    stateUpdateCallback = vi.fn();
  });

  describe('Connection', () => {
    it('should connect to peripheral successfully', async () => {
      const device = new ILinkDevice(deviceConfig, stateUpdateCallback);
      mockPeripheral.state = 'disconnected';

      const connected = await device.connect(mockPeripheral);

      expect(connected).toBe(true);
      expect(mockPeripheral.connectAsync).toHaveBeenCalled();
      expect(mockPeripheral.discoverAllServicesAndCharacteristicsAsync).toHaveBeenCalled();
    });

    it('should handle already connected peripheral', async () => {
      const device = new ILinkDevice(deviceConfig, stateUpdateCallback);
      mockPeripheral.state = 'connected';

      const connected = await device.connect(mockPeripheral);

      expect(connected).toBe(true);
      // Should still discover services even if already connected
      expect(mockPeripheral.discoverAllServicesAndCharacteristicsAsync).toHaveBeenCalled();
    });

    it('should find target characteristic', async () => {
      const device = new ILinkDevice(deviceConfig, stateUpdateCallback);
      await device.connect(mockPeripheral);

      expect(device.isConnected()).toBe(true);
    });

    it('should find status characteristic if available', async () => {
      const device = new ILinkDevice(deviceConfig, stateUpdateCallback);
      await device.connect(mockPeripheral);

      // Status characteristic should be found
      expect(mockPeripheral.discoverAllServicesAndCharacteristicsAsync).toHaveBeenCalled();
    });

    it('should fail if characteristic not found', async () => {
      mockPeripheral.discoverAllServicesAndCharacteristicsAsync = vi.fn().mockResolvedValue({
        characteristics: [], // No characteristics
      });

      const device = new ILinkDevice(deviceConfig, stateUpdateCallback);
      const connected = await device.connect(mockPeripheral);

      expect(connected).toBe(false);
      expect(mockPeripheral.disconnectAsync).toHaveBeenCalled();
    });

    it('should handle connection timeout', async () => {
      mockPeripheral.connectAsync = vi.fn().mockImplementation(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 20000))
      );

      const device = new ILinkDevice(deviceConfig, stateUpdateCallback);
      
      // Should timeout after 15 seconds (device has 15s timeout)
      const result = await device.connect(mockPeripheral);
      expect(result).toBe(false);
    }, 20000); // Increase Jest timeout for this test
  });

  describe('Disconnection', () => {
    it('should disconnect gracefully', async () => {
      const device = new ILinkDevice(deviceConfig, stateUpdateCallback);
      await device.connect(mockPeripheral);
      
      await device.disconnect();

      expect(mockPeripheral.disconnectAsync).toHaveBeenCalled();
      expect(device.isConnected()).toBe(false);
    });

    it('should handle disconnect when not connected', async () => {
      const device = new ILinkDevice(deviceConfig, stateUpdateCallback);
      
      await expect(device.disconnect()).resolves.not.toThrow();
    });
  });

  describe('Command sending', () => {
    beforeEach(async () => {
      const device = new ILinkDevice(deviceConfig, stateUpdateCallback);
      await device.connect(mockPeripheral);
    });

    it('should send ON command', async () => {
      const device = new ILinkDevice(deviceConfig, stateUpdateCallback);
      await device.connect(mockPeripheral);

      const command: MQTTCommand = { state: 'ON' };
      const result = await device.sendCommand(command);

      expect(result).toBe(true);
      expect(mockCharacteristic.writeAsync).toHaveBeenCalled();
      const writtenBuffer = mockCharacteristic.writeAsync.mock.calls[0][0] as Buffer;
      expect(writtenBuffer.toString('hex')).toBe('55aa01080501f1');
    });

    it('should send OFF command', async () => {
      const device = new ILinkDevice(deviceConfig, stateUpdateCallback);
      await device.connect(mockPeripheral);

      const command: MQTTCommand = { state: 'OFF' };
      const result = await device.sendCommand(command);

      expect(result).toBe(true);
      const writtenBuffer = mockCharacteristic.writeAsync.mock.calls[0][0] as Buffer;
      expect(writtenBuffer.toString('hex')).toBe('55aa01080500f2');
    });

    it('should send color command', async () => {
      const device = new ILinkDevice(deviceConfig, stateUpdateCallback);
      await device.connect(mockPeripheral);

      const command: MQTTCommand = {
        color: { r: 255, g: 0, b: 0 },
      };
      const result = await device.sendCommand(command);

      expect(result).toBe(true);
      const writtenBuffer = mockCharacteristic.writeAsync.mock.calls[0][0] as Buffer;
      expect(writtenBuffer.toString('hex')).toBe('55aa030802ff0000f4');
      expect(stateUpdateCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          power: true,
          color: { r: 255, g: 0, b: 0 },
        })
      );
    });

    it('should send brightness command', async () => {
      const device = new ILinkDevice(deviceConfig, stateUpdateCallback);
      await device.connect(mockPeripheral);

      const command: MQTTCommand = { brightness: 255 };
      const result = await device.sendCommand(command);

      expect(result).toBe(true);
      expect(stateUpdateCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          power: true,
          brightness: expect.any(Number),
        })
      );
    });

    it('should convert brightness from 0-255 to 0-100', async () => {
      const device = new ILinkDevice(deviceConfig, stateUpdateCallback);
      await device.connect(mockPeripheral);

      const command: MQTTCommand = { brightness: 128 }; // 50% of 255
      await device.sendCommand(command);

      const state = device.getState();
      expect(state.brightness).toBeGreaterThanOrEqual(0);
      expect(state.brightness).toBeLessThanOrEqual(100);
    });

    it('should clamp brightness values', async () => {
      const device = new ILinkDevice(deviceConfig, stateUpdateCallback);
      await device.connect(mockPeripheral);

      const command1: MQTTCommand = { brightness: -10 };
      await device.sendCommand(command1);
      expect(device.getState().brightness).toBeGreaterThanOrEqual(0);

      const command2: MQTTCommand = { brightness: 300 };
      await device.sendCommand(command2);
      expect(device.getState().brightness).toBeLessThanOrEqual(100);
    });

    it('should fail if not connected', async () => {
      const device = new ILinkDevice(deviceConfig, stateUpdateCallback);
      // Don't connect

      const command: MQTTCommand = { state: 'ON' };
      const result = await device.sendCommand(command);

      expect(result).toBe(false);
      expect(mockCharacteristic.writeAsync).not.toHaveBeenCalled();
    });

    it('should handle write errors gracefully', async () => {
      const device = new ILinkDevice(deviceConfig, stateUpdateCallback);
      await device.connect(mockPeripheral);

      mockCharacteristic.writeAsync = vi.fn().mockRejectedValue(new Error('Write failed'));

      const command: MQTTCommand = { state: 'ON' };
      const result = await device.sendCommand(command);

      expect(result).toBe(false);
    });

    it('should update state when sending commands', async () => {
      const device = new ILinkDevice(deviceConfig, stateUpdateCallback);
      await device.connect(mockPeripheral);

      const command: MQTTCommand = { state: 'ON' };
      await device.sendCommand(command);

      expect(stateUpdateCallback).toHaveBeenCalled();
      const state = device.getState();
      expect(state.power).toBe(true);
    });
  });

  describe('State reading', () => {
    it('should read state from status characteristic', async () => {
      const device = new ILinkDevice(deviceConfig, stateUpdateCallback);
      await device.connect(mockPeripheral);

      const state = await device.readState();

      expect(mockStatusCharacteristic.readAsync).toHaveBeenCalled();
      expect(state).not.toBeNull();
    });

    it('should return null if no status characteristic', async () => {
      mockPeripheral.discoverAllServicesAndCharacteristicsAsync = vi.fn().mockResolvedValue({
        characteristics: [mockCharacteristic], // No status characteristic
      });

      const device = new ILinkDevice(deviceConfig, stateUpdateCallback);
      await device.connect(mockPeripheral);

      const state = await device.readState();

      expect(state).toBeNull();
    });

    it('should return null if not connected', async () => {
      const device = new ILinkDevice(deviceConfig, stateUpdateCallback);
      // Don't connect

      const state = await device.readState();

      expect(state).toBeNull();
    });

    it('should handle read errors gracefully', async () => {
      const device = new ILinkDevice(deviceConfig, stateUpdateCallback);
      await device.connect(mockPeripheral);

      mockStatusCharacteristic.readAsync = vi.fn().mockRejectedValue(new Error('Read failed'));

      const state = await device.readState();

      expect(state).toBeNull();
    });

    it('should update state callback after reading', async () => {
      const device = new ILinkDevice(deviceConfig, stateUpdateCallback);
      await device.connect(mockPeripheral);

      await device.readState();

      expect(stateUpdateCallback).toHaveBeenCalled();
    });
  });

  describe('State management', () => {
    it('should return current state', () => {
      const device = new ILinkDevice(deviceConfig, stateUpdateCallback);
      const state = device.getState();

      expect(state).toHaveProperty('power');
      expect(state).toHaveProperty('brightness');
    });

    it('should return a copy of state, not reference', () => {
      const device = new ILinkDevice(deviceConfig, stateUpdateCallback);
      const state1 = device.getState();
      const state2 = device.getState();

      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });

    it('should initialize with default state', () => {
      const device = new ILinkDevice(deviceConfig, stateUpdateCallback);
      const state = device.getState();

      expect(state.power).toBe(false);
      expect(state.brightness).toBe(100);
    });
  });

  describe('Connection status', () => {
    it('should return false when not connected', () => {
      const device = new ILinkDevice(deviceConfig, stateUpdateCallback);
      expect(device.isConnected()).toBe(false);
    });

    it('should return true when connected', async () => {
      const device = new ILinkDevice(deviceConfig, stateUpdateCallback);
      await device.connect(mockPeripheral);
      expect(device.isConnected()).toBe(true);
    });

    it('should return false after disconnection', async () => {
      const device = new ILinkDevice(deviceConfig, stateUpdateCallback);
      await device.connect(mockPeripheral);
      await device.disconnect();
      expect(device.isConnected()).toBe(false);
    });
  });
});
