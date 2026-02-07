import * as dotenv from 'dotenv';
import { BLEManager } from './ble-manager';
import { MQTTBridge } from './mqtt-bridge';
import { DeviceConfig, LightState } from './types';
import { ILinkDevice } from './device';

dotenv.config();

interface Config {
  devices: DeviceConfig[];
  mqtt: {
    brokerUrl: string;
    username?: string;
    password?: string;
    baseTopic?: string;
  };
}

async function loadConfig(): Promise<Config> {
  // Load from environment variables or config file
  const devicesJson = process.env.DEVICES || '[]';
  let devices: DeviceConfig[] = [];
  
  try {
    devices = JSON.parse(devicesJson);
  } catch (error) {
    console.error('[Config] Failed to parse DEVICES JSON:', error);
    console.error('[Config] DEVICES value:', devicesJson);
    console.error('[Config] Make sure DEVICES is a valid JSON array on a single line');
    throw new Error('Invalid DEVICES configuration. Must be a valid JSON array.');
  }

  return {
    devices,
    mqtt: {
      brokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
      username: process.env.MQTT_USERNAME,
      password: process.env.MQTT_PASSWORD,
      baseTopic: process.env.MQTT_BASE_TOPIC || 'ilink',
    },
  };
}

async function main() {
  console.log('[Main] Starting iLink Home Assistant Bridge...');

  try {
    // Load configuration
    const config = await loadConfig();
    console.log(`[Main] Loaded ${config.devices.length} device(s)`);

    if (config.devices.length === 0) {
      console.error('[Main] No devices configured. Please set DEVICES environment variable.');
      process.exit(1);
    }

    // Initialize MQTT bridge first
    const mqttBridge = new MQTTBridge(
      config.mqtt.brokerUrl,
      {
        username: config.mqtt.username,
        password: config.mqtt.password,
      },
      config.mqtt.baseTopic
    );

    await mqttBridge.connect();
    console.log('[Main] MQTT bridge connected');

    // Initialize BLE manager with state update callback
    const bleManager = new BLEManager((deviceId, state: LightState) => {
      // State update callback - publish to MQTT
      mqttBridge.publishState(deviceId, state);
    });

    await bleManager.initialize();
    console.log('[Main] BLE manager initialized');

    // Connect to all configured devices sequentially with delays
    // This prevents overwhelming the Bluetooth stack on Raspberry Pi
    const connectedDevices: ILinkDevice[] = [];

    for (let i = 0; i < config.devices.length; i++) {
      const deviceConfig = config.devices[i];
      console.log(`[Main] Connecting to ${deviceConfig.name}...`);
      
      // Add a delay before connecting (except for the first device)
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      const device = await bleManager.connectDevice(deviceConfig);
      
      if (device) {
        mqttBridge.registerDevice(device, deviceConfig);
        connectedDevices.push(device);
        
        // Publish initial state
        const initialState = device.getState();
        mqttBridge.publishState(deviceConfig.id, initialState);
        
        // Add a small delay after successful connection to let it stabilize
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        console.error(`[Main] Failed to connect to ${deviceConfig.name}`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (connectedDevices.length === 0) {
      console.error('[Main] No devices connected. Exiting.');
      process.exit(1);
    }

    console.log(`[Main] Bridge running. ${connectedDevices.length} device(s) connected.`);

    // Periodic state updates (every 30 seconds)
    setInterval(async () => {
      for (const device of connectedDevices) {
        if (device.isConnected()) {
          await device.readState();
        }
      }
    }, 30000);

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('[Main] Shutting down...');
      await bleManager.disconnectAll();
      mqttBridge.disconnect();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('[Main] Shutting down...');
      await bleManager.disconnectAll();
      mqttBridge.disconnect();
      process.exit(0);
    });

  } catch (error) {
    console.error('[Main] Fatal error:', error);
    process.exit(1);
  }
}

main();
