import mqtt, { MqttClient } from 'mqtt';
import { DeviceConfig, MQTTCommand, MQTTState, LightState } from './types';
import { ILinkDevice } from './device';

export class MQTTBridge {
  private client: MqttClient | null = null;
  private devices = new Map<string, ILinkDevice>();
  private baseTopic: string;

  constructor(
    private brokerUrl: string,
    private brokerOptions?: {
      username?: string;
      password?: string;
      clientId?: string;
    },
    baseTopic: string = 'ilink'
  ) {
    this.baseTopic = baseTopic;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const options: any = {
        clientId: this.brokerOptions?.clientId || `ilink-bridge-${Date.now()}`,
        reconnectPeriod: 5000,
        connectTimeout: 10000,
      };

      if (this.brokerOptions?.username) {
        options.username = this.brokerOptions.username;
      }
      if (this.brokerOptions?.password) {
        options.password = this.brokerOptions.password;
      }

      this.client = mqtt.connect(this.brokerUrl, options);

      this.client.on('connect', () => {
        console.log(`[MQTT] Connected to broker at ${this.brokerUrl}`);
        this.subscribeToCommands();
        resolve();
      });

      this.client.on('error', (error) => {
        console.error('[MQTT] Error:', error);
        reject(error);
      });

      this.client.on('message', (topic, payload) => {
        this.handleMessage(topic, payload.toString());
      });

      this.client.on('reconnect', () => {
        console.log('[MQTT] Reconnecting...');
      });

      this.client.on('close', () => {
        console.log('[MQTT] Connection closed');
      });
    });
  }

  private subscribeToCommands(): void {
    // Subscribe to all device command topics
    const commandTopic = `${this.baseTopic}/+/set`;
    this.client?.subscribe(commandTopic, (err) => {
      if (err) {
        console.error(`[MQTT] Failed to subscribe to ${commandTopic}:`, err);
      } else {
        console.log(`[MQTT] Subscribed to ${commandTopic}`);
      }
    });
  }

  private handleMessage(topic: string, payload: string): void {
    // Topic format: ilink/{deviceId}/set
    const match = topic.match(new RegExp(`^${this.baseTopic.replace(/\+/g, '\\+')}/([^/]+)/set$`));
    if (!match) {
      return;
    }

    const deviceId = match[1];
    const device = this.devices.get(deviceId);

    if (!device) {
      console.warn(`[MQTT] Device ${deviceId} not found`);
      return;
    }

    try {
      const command: MQTTCommand = JSON.parse(payload);
      console.log(`[MQTT] Received command for ${deviceId}:`, command);
      device.sendCommand(command);
    } catch (error) {
      console.error(`[MQTT] Failed to parse command for ${deviceId}:`, error);
    }
  }

  registerDevice(device: ILinkDevice, config: DeviceConfig): void {
    this.devices.set(config.id, device);
    console.log(`[MQTT] Registered device: ${config.name} (${config.id})`);
  }

  publishState(deviceId: string, state: LightState): void {
    if (!this.client) {
      console.warn(`[MQTT] Cannot publish state for ${deviceId}: MQTT client not initialized`);
      return;
    }

    if (!this.client.connected) {
      console.warn(`[MQTT] Cannot publish state for ${deviceId}: MQTT client not connected`);
      return;
    }

    const mqttState: MQTTState = {
      state: state.power ? 'ON' : 'OFF',
    };

    if (state.brightness !== undefined) {
      // Convert 0-100 to 0-255 for Home Assistant
      mqttState.brightness = Math.floor((state.brightness / 100) * 255);
    }

    if (state.color) {
      mqttState.color = state.color;
    }

    if (state.colorTemperature !== undefined) {
      // Convert 0-100 to mireds (approximate: 153-500 mireds)
      mqttState.color_temp = Math.floor(153 + (state.colorTemperature / 100) * 347);
    }

    const topic = `${this.baseTopic}/${deviceId}/state`;
    const payload = JSON.stringify(mqttState);

    console.log(`[MQTT] Publishing state for ${deviceId} to topic ${topic}:`, mqttState);
    
    this.client.publish(topic, payload, { retain: true, qos: 1 }, (err) => {
      if (err) {
        console.error(`[MQTT] Failed to publish state for ${deviceId}:`, err);
      } else {
        console.log(`[MQTT] Successfully published state for ${deviceId}`);
      }
    });
  }

  disconnect(): void {
    if (this.client) {
      this.client.end();
      this.client = null;
    }
  }
}
