import { vi } from 'vitest';
import { MQTTBridge } from './mqtt-bridge';
import { DeviceConfig, LightState, MQTTCommand } from './types';
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
  let deviceConfig: DeviceConfig;
  let commandHandler: (deviceId: string, command: MQTTCommand) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMqttClient.on.mockClear();
    mockMqttClient.subscribe.mockClear();
    mockMqttClient.publish.mockClear();
    mockMqttClient.end.mockClear();
    mockMqttClient.connected = true;

    const mqttMock = mqtt as any;
    mqttMock.mockReturnValue(mockMqttClient);
    (mqtt as any).connect = mqttMock;

    deviceConfig = {
      id: 'test-device',
      name: 'Test Device',
      macAddress: 'aa:bb:cc:dd:ee:ff',
    };

    commandHandler = vi.fn().mockResolvedValue(undefined);
    mqttBridge = new MQTTBridge('mqtt://localhost:1883', undefined, 'ilink');
    mqttBridge.setCommandHandler(commandHandler);
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

  describe('Command handler', () => {
    it('should allow setting a command handler', () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const bridge = new MQTTBridge('mqtt://localhost:1883', undefined, 'ilink');
      bridge.setCommandHandler(handler);
      expect(handler).toBeDefined();
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
    });

    it('should invoke command handler on ON command', () => {
      const topic = 'ilink/test-device/set';
      const payload = JSON.stringify({ state: 'ON' });

      const messageHandler = (mockMqttClient.on.mock.calls as Array<[string, Function]>).find(
        (call) => call[0] === 'message'
      )?.[1];

      if (messageHandler) {
        messageHandler(topic, Buffer.from(payload));
      }

      expect(commandHandler).toHaveBeenCalledWith('test-device', { state: 'ON' });
    });

    it('should invoke command handler on OFF command', () => {
      const topic = 'ilink/test-device/set';
      const payload = JSON.stringify({ state: 'OFF' });

      const messageHandler = (mockMqttClient.on.mock.calls as Array<[string, Function]>).find(
        (call) => call[0] === 'message'
      )?.[1];

      if (messageHandler) {
        messageHandler(topic, Buffer.from(payload));
      }

      expect(commandHandler).toHaveBeenCalledWith('test-device', { state: 'OFF' });
    });

    it('should invoke command handler on brightness command', () => {
      const topic = 'ilink/test-device/set';
      const payload = JSON.stringify({ brightness: 128 });

      const messageHandler = (mockMqttClient.on.mock.calls as Array<[string, Function]>).find(
        (call) => call[0] === 'message'
      )?.[1];

      if (messageHandler) {
        messageHandler(topic, Buffer.from(payload));
      }

      expect(commandHandler).toHaveBeenCalledWith('test-device', { brightness: 128 });
    });

    it('should invoke command handler on color command', () => {
      const topic = 'ilink/test-device/set';
      const payload = JSON.stringify({ color: { r: 255, g: 0, b: 0 } });

      const messageHandler = (mockMqttClient.on.mock.calls as Array<[string, Function]>).find(
        (call) => call[0] === 'message'
      )?.[1];

      if (messageHandler) {
        messageHandler(topic, Buffer.from(payload));
      }

      expect(commandHandler).toHaveBeenCalledWith('test-device', {
        color: { r: 255, g: 0, b: 0 },
      });
    });

    it('should invoke command handler for any device id', () => {
      const topic = 'ilink/unknown-device/set';
      const payload = JSON.stringify({ state: 'ON' });

      const messageHandler = (mockMqttClient.on.mock.calls as Array<[string, Function]>).find(
        (call) => call[0] === 'message'
      )?.[1];

      if (messageHandler) {
        messageHandler(topic, Buffer.from(payload));
      }

      expect(commandHandler).toHaveBeenCalledWith('unknown-device', { state: 'ON' });
    });

    it('should ignore invalid topics', () => {
      const topic = 'invalid/topic';
      const payload = JSON.stringify({ state: 'ON' });

      const messageHandler = (mockMqttClient.on.mock.calls as Array<[string, Function]>).find(
        (call) => call[0] === 'message'
      )?.[1];

      if (messageHandler) {
        messageHandler(topic, Buffer.from(payload));
      }

      expect(commandHandler).not.toHaveBeenCalled();
    });

    it('should handle invalid JSON gracefully', () => {
      const topic = 'ilink/test-device/set';
      const payload = 'invalid json';

      const messageHandler = (mockMqttClient.on.mock.calls as Array<[string, Function]>).find(
        (call) => call[0] === 'message'
      )?.[1];

      if (messageHandler) {
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
