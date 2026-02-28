import * as dotenv from 'dotenv';
import { BLEManager } from './ble-manager';
import { BleQueue } from './ble-queue';
import { MQTTBridge } from './mqtt-bridge';
import { DeviceConfig, LightState } from './types';

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
  console.log('[Main] Starting iLink Home Assistant Bridge (short-burst BLE)...');

  try {
    const config = await loadConfig();
    console.log(`[Main] Loaded ${config.devices.length} device(s)`);

    if (config.devices.length === 0) {
      console.error('[Main] No devices configured. Please set DEVICES environment variable.');
      process.exit(1);
    }

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

    const bleQueue = new BleQueue();
    const bleManager = new BLEManager((deviceId, state: LightState) => {
      mqttBridge.publishState(deviceId, state);
    });

    await bleManager.initialize();
    console.log('[Main] BLE manager initialized');

    // Scan once to fill peripheral cache (no connections)
    console.log('[Main] Scanning for configured devices (cache only, no connection)...');
    const scanned = await bleManager.scanForAllDevices(config.devices);
    console.log(`[Main] Cached ${scanned.size} of ${config.devices.length} device(s)`);

    if (scanned.size === 0) {
      console.warn(
        '[Main] No devices found in scan. Commands will trigger on-demand scan (slower).'
      );
    }

    // Command handler: serialize BLE, connect → send → disconnect per command
    mqttBridge.setCommandHandler(async (deviceId, command) => {
      const deviceConfig = config.devices.find((d) => d.id === deviceId);
      if (!deviceConfig) {
        console.warn(`[MQTT] Unknown device ${deviceId}`);
        return;
      }

      await bleQueue.schedule(() =>
        bleManager.withDevice(deviceConfig, async (device) => {
          await device.sendCommand(command);
          mqttBridge.publishState(deviceId, device.getState());
        })
      );
    });

    console.log(
      '[Main] Bridge running. Commands will connect → send → disconnect (no persistent BLE).'
    );

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
