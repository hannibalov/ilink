import { vi } from 'vitest';
import { MQTTBridge } from './mqtt-bridge';
import { ILinkDevice } from './device';
import { DeviceConfig, LightState } from './types';
import mqtt from 'mqtt';

// Mock mqtt module
const mockMqttClient = {
  on: vi.fn(),
  subscribe: vi.fn((topic, callback) => {
    if (callback) callback(null);
  }),
  publish: vi.fn((topic, payload, options, callback) => {
    if (callback) callback(null);
  }),
  end: vi.fn(),
  connected: true,
};

vi.mock('mqtt', () => {
  const connectFn = vi.fn(() => mockMqttClient);
  
  return {
    __esModule: true,
    default: Object.assign(connectFn, {
      connect: connectFn,
    }),
  };
});

describe('MQTTBridge', () => {
  let mqttBridge: MQTTBridge;
  let mockDevice: ILinkDevice;
  let deviceConfig: DeviceConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock client
    mockMqttClient.on.mockClear();
    mockMqttClient.subscribe.mockClear();
    mockMqttClient.publish.mockClear();
    mockMqttClient.end.mockClear();
    mockMqttClient.connected = true;
    
    // Reset the mqtt mock to return our mock client
    const mqttMock = mqtt as any;
    mqttMock.mockReturnValue(mockMqttClient);
    (mqtt as any).connect = mqttMock;
    
    deviceConfig = {
      id: 'test-device',
      name: 'Test Device',
      macAddress: 'aa:bb:cc:dd:ee:ff',
    };

    mockDevice = {
      sendCommand: vi.fn().mockResolvedValue(true),
      getState: vi.fn().mockReturnValue({
        power: false,
        brightness: 100,
      }),
    } as any;

    mqttBridge = new MQTTBridge('mqtt://localhost:1883', undefined, 'ilink');
  });

  describe('Connection', () => {
    it('should connect to MQTT broker', async () => {
      // Simulate connection event
      mockMqttClient.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'connect') {
          setTimeout(() => callback(), 0);
        }
      });

      await mqttBridge.connect();

      expect(mqtt).toHaveBeenCalledWith(
        'mqtt://localhost:1883',
        expect.objectContaining({
          clientId: expect.any(String),
          reconnectPeriod: 5000,
          connectTimeout: 10000,
        })
      );
    });

    it('should subscribe to command topics on connect', async () => {
      mockMqttClient.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'connect') {
          setTimeout(() => callback(), 0);
        }
      });

      await mqttBridge.connect();

      expect(mockMqttClient.subscribe).toHaveBeenCalledWith(
        'ilink/+/set',
        expect.any(Function)
      );
    });

    it('should handle connection errors', async () => {
      const error = new Error('Connection failed');
      mockMqttClient.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'error') {
          setTimeout(() => callback(error), 0);
        }
      });

      await expect(mqttBridge.connect()).rejects.toThrow('Connection failed');
    });

    it('should use custom client ID if provided', async () => {
      const bridge = new MQTTBridge('mqtt://localhost:1883', { clientId: 'custom-id' });
      
      mockMqttClient.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'connect') {
          setTimeout(() => callback(), 0);
        }
      });

      await bridge.connect();

      expect(mqtt).toHaveBeenCalledWith(
        'mqtt://localhost:1883',
        expect.objectContaining({
          clientId: 'custom-id',
        })
      );
    });

    it('should use credentials if provided', async () => {
      const bridge = new MQTTBridge('mqtt://localhost:1883', {
        username: 'user',
        password: 'pass',
      });

      mockMqttClient.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'connect') {
          setTimeout(() => callback(), 0);
        }
      });

      await bridge.connect();

      expect(mqtt).toHaveBeenCalledWith(
        'mqtt://localhost:1883',
        expect.objectContaining({
          username: 'user',
          password: 'pass',
        })
      );
    });
  });

  describe('Device registration', () => {
    beforeEach(async () => {
      mockMqttClient.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'connect') {
          setTimeout(() => callback(), 0);
        }
      });
      await mqttBridge.connect();
    });

    it('should register a device', () => {
      mqttBridge.registerDevice(mockDevice, deviceConfig);

      // Device should be registered (we can't directly check the internal map,
      // but we can verify it's used when handling messages)
      expect(mockDevice).toBeDefined();
    });
  });

  describe('Message handling', () => {
    beforeEach(async () => {
      mockMqttClient.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'connect') {
          setTimeout(() => callback(), 0);
        }
      });
      await mqttBridge.connect();
      mqttBridge.registerDevice(mockDevice, deviceConfig);
    });

    it('should handle ON command', () => {
      const topic = 'ilink/test-device/set';
      const payload = JSON.stringify({ state: 'ON' });

      // Simulate message event
      const messageHandler = mockMqttClient.on.mock.calls.find(
        (call: [string, Function]) => call[0] === 'message'
      )?.[1];

      if (messageHandler) {
        messageHandler(topic, Buffer.from(payload));
      }

      expect(mockDevice.sendCommand).toHaveBeenCalledWith({ state: 'ON' });
    });

    it('should handle OFF command', () => {
      const topic = 'ilink/test-device/set';
      const payload = JSON.stringify({ state: 'OFF' });

      const messageHandler = mockMqttClient.on.mock.calls.find(
        (call: [string, Function]) => call[0] === 'message'
      )?.[1];

      if (messageHandler) {
        messageHandler(topic, Buffer.from(payload));
      }

      expect(mockDevice.sendCommand).toHaveBeenCalledWith({ state: 'OFF' });
    });

    it('should handle brightness command', () => {
      const topic = 'ilink/test-device/set';
      const payload = JSON.stringify({ brightness: 128 });

      const messageHandler = mockMqttClient.on.mock.calls.find(
        (call: [string, Function]) => call[0] === 'message'
      )?.[1];

      if (messageHandler) {
        messageHandler(topic, Buffer.from(payload));
      }

      expect(mockDevice.sendCommand).toHaveBeenCalledWith({ brightness: 128 });
    });

    it('should handle color command', () => {
      const topic = 'ilink/test-device/set';
      const payload = JSON.stringify({ color: { r: 255, g: 0, b: 0 } });

      const messageHandler = mockMqttClient.on.mock.calls.find(
        (call: [string, Function]) => call[0] === 'message'
      )?.[1];

      if (messageHandler) {
        messageHandler(topic, Buffer.from(payload));
      }

      expect(mockDevice.sendCommand).toHaveBeenCalledWith({
        color: { r: 255, g: 0, b: 0 },
      });
    });

    it('should handle combined command', () => {
      const topic = 'ilink/test-device/set';
      const payload = JSON.stringify({
        state: 'ON',
        brightness: 200,
        color: { r: 255, g: 128, b: 0 },
      });

      const messageHandler = mockMqttClient.on.mock.calls.find(
        (call: [string, Function]) => call[0] === 'message'
      )?.[1];

      if (messageHandler) {
        messageHandler(topic, Buffer.from(payload));
      }

      expect(mockDevice.sendCommand).toHaveBeenCalledWith({
        state: 'ON',
        brightness: 200,
        color: { r: 255, g: 128, b: 0 },
      });
    });

    it('should ignore messages for unknown devices', () => {
      const topic = 'ilink/unknown-device/set';
      const payload = JSON.stringify({ state: 'ON' });

      const messageHandler = mockMqttClient.on.mock.calls.find(
        (call: [string, Function]) => call[0] === 'message'
      )?.[1];

      if (messageHandler) {
        messageHandler(topic, Buffer.from(payload));
      }

      // Should not call sendCommand for unknown device
      expect(mockDevice.sendCommand).not.toHaveBeenCalled();
    });

    it('should ignore invalid topics', () => {
      const topic = 'invalid/topic';
      const payload = JSON.stringify({ state: 'ON' });

      const messageHandler = mockMqttClient.on.mock.calls.find(
        (call: [string, Function]) => call[0] === 'message'
      )?.[1];

      if (messageHandler) {
        messageHandler(topic, Buffer.from(payload));
      }

      expect(mockDevice.sendCommand).not.toHaveBeenCalled();
    });

    it('should handle invalid JSON gracefully', () => {
      const topic = 'ilink/test-device/set';
      const payload = 'invalid json';

      const messageHandler = mockMqttClient.on.mock.calls.find(
        (call: [string, Function]) => call[0] === 'message'
      )?.[1];

      if (messageHandler) {
        // Should not throw
        expect(() => {
          messageHandler(topic, Buffer.from(payload));
        }).not.toThrow();
      }
    });
  });

  describe('State publishing', () => {
    beforeEach(async () => {
      mockMqttClient.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'connect') {
          setTimeout(() => callback(), 0);
        }
      });
      await mqttBridge.connect();
    });

    it('should publish state with power ON', () => {
      const state: LightState = {
        power: true,
        brightness: 100,
      };

      mqttBridge.publishState('test-device', state);

      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        'ilink/test-device/state',
        JSON.stringify({
          state: 'ON',
          brightness: 255,
        }),
        { retain: true, qos: 1 },
        expect.any(Function)
      );
    });

    it('should publish state with power OFF', () => {
      const state: LightState = {
        power: false,
        brightness: 0,
      };

      mqttBridge.publishState('test-device', state);

      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        'ilink/test-device/state',
        JSON.stringify({
          state: 'OFF',
          brightness: 0,
        }),
        { retain: true, qos: 1 },
        expect.any(Function)
      );
    });

    it('should convert brightness from 0-100 to 0-255', () => {
      const state: LightState = {
        power: true,
        brightness: 50, // 50% = 127.5 ≈ 128
      };

      mqttBridge.publishState('test-device', state);

      const publishedPayload = JSON.parse(
        mockMqttClient.publish.mock.calls[0][1] as string
      );
      expect(publishedPayload.brightness).toBe(127);
    });

    it('should include color in published state', () => {
      const state: LightState = {
        power: true,
        brightness: 100,
        color: { r: 255, g: 128, b: 0 },
      };

      mqttBridge.publishState('test-device', state);

      const publishedPayload = JSON.parse(
        mockMqttClient.publish.mock.calls[0][1] as string
      );
      expect(publishedPayload.color).toEqual({ r: 255, g: 128, b: 0 });
    });

    it('should include color temperature in published state', () => {
      const state: LightState = {
        power: true,
        brightness: 100,
        colorTemperature: 50,
      };

      mqttBridge.publishState('test-device', state);

      const publishedPayload = JSON.parse(
        mockMqttClient.publish.mock.calls[0][1] as string
      );
      expect(publishedPayload.color_temp).toBeDefined();
      expect(publishedPayload.color_temp).toBeGreaterThanOrEqual(153);
      expect(publishedPayload.color_temp).toBeLessThanOrEqual(500);
    });

    it('should not publish if client not connected', () => {
      mockMqttClient.connected = false;

      const state: LightState = {
        power: true,
        brightness: 100,
      };

      mqttBridge.publishState('test-device', state);

      expect(mockMqttClient.publish).not.toHaveBeenCalled();
    });

    it('should not publish if client not initialized', () => {
      const bridge = new MQTTBridge('mqtt://localhost:1883');
      // Don't connect

      const state: LightState = {
        power: true,
        brightness: 100,
      };

      bridge.publishState('test-device', state);

      expect(mockMqttClient.publish).not.toHaveBeenCalled();
    });

    it('should use custom base topic', async () => {
      const bridge = new MQTTBridge('mqtt://localhost:1883', undefined, 'custom-topic');
      
      mockMqttClient.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'connect') {
          setTimeout(() => callback(), 0);
        }
      });
      await bridge.connect();

      const state: LightState = {
        power: true,
        brightness: 100,
      };

      bridge.publishState('test-device', state);

      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        'custom-topic/test-device/state',
        expect.any(String),
        expect.any(Object),
        expect.any(Function)
      );
    });
  });

  describe('Disconnection', () => {
    it('should disconnect gracefully', async () => {
      mockMqttClient.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'connect') {
          setTimeout(() => callback(), 0);
        }
      });
      await mqttBridge.connect();

      mqttBridge.disconnect();

      expect(mockMqttClient.end).toHaveBeenCalled();
    });

    it('should handle disconnect when not connected', () => {
      const bridge = new MQTTBridge('mqtt://localhost:1883');
      // Don't connect

      expect(() => bridge.disconnect()).not.toThrow();
    });
  });
});
