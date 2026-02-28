import mqtt, { MqttClient } from 'mqtt';
import { MQTTCommand, MQTTState, LightState } from './types';

/** Called when an MQTT command is received. Implementor should run BLE in queue and publish state. */
export type CommandHandler = (deviceId: string, command: MQTTCommand) => Promise<void>;

export class MQTTBridge {
  private client: MqttClient | null = null;
  private baseTopic: string;
  private commandHandler: CommandHandler | null = null;

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

  setCommandHandler(handler: CommandHandler): void {
    this.commandHandler = handler;
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
    const match = topic.match(new RegExp(`^${this.baseTopic.replace(/\+/g, '\\+')}/([^/]+)/set$`));
    if (!match) return;

    const deviceId = match[1];
    if (!this.commandHandler) {
      console.warn(`[MQTT] No command handler set; ignoring command for ${deviceId}`);
      return;
    }

    try {
      const command: MQTTCommand = JSON.parse(payload);
      console.log(`[MQTT] Received command for ${deviceId}:`, command);
      this.commandHandler(deviceId, command).catch((err) => {
        console.error(`[MQTT] Command failed for ${deviceId}:`, err);
      });
    } catch (error) {
      console.error(`[MQTT] Failed to parse command for ${deviceId}:`, error);
    }
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
