import * as dotenv from 'dotenv';
import { BLEManager } from './ble-manager';
import { MQTTBridge } from './mqtt-bridge';
import { DeviceConfig, LightState } from './types';
import { ILinkDevice } from './device';
import { Peripheral } from '@abandonware/noble';

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

    // CRITICAL FIX: Scan for all devices FIRST, then connect sequentially
    // Raspberry Pi Bluetooth adapters cannot scan while connected to BLE devices
    // By scanning upfront, we avoid the need to scan during connection
    console.log('[Main] Scanning for all configured devices...');
    const scannedPeripherals = await bleManager.scanForAllDevices(config.devices);
    console.log(`[Main] Found ${scannedPeripherals.size} of ${config.devices.length} device(s) during scan`);

    // OPTIMIZED: Try connecting to all devices in parallel first
    // This tests if the adapter can handle concurrent connections
    // If parallel fails, fall back to sequential with optimized timing
    const connectedDevices: ILinkDevice[] = [];
    
    console.log('[Main] Attempting parallel connections to test concurrent support...');
    const connectionPromises = config.devices.map(async (deviceConfig) => {
      const peripheral = scannedPeripherals.get(deviceConfig.id);
      if (!peripheral) {
        console.error(`[Main] Peripheral not found for ${deviceConfig.name} - skipping`);
        return null;
      }
      
      console.log(`[Main] Starting connection to ${deviceConfig.name}...`);
      try {
        const device = await bleManager.connectDevice(deviceConfig, peripheral);
        if (device) {
          mqttBridge.registerDevice(device, deviceConfig);
          const initialState = device.getState();
          mqttBridge.publishState(deviceConfig.id, initialState);
          console.log(`[Main] ✓ Successfully connected to ${deviceConfig.name}`);
          return device;
        }
        return null;
      } catch (error) {
        console.error(`[Main] Failed to connect to ${deviceConfig.name}:`, error);
        return null;
      }
    });
    
    // Wait for all parallel connection attempts with individual timeouts
    // Use Promise.allSettled to collect all results, even if some timeout
    const connectionTimeout = 90000; // 90 seconds per device
    const parallelResults = await Promise.allSettled(
      connectionPromises.map(promise => 
        Promise.race([
          promise,
          new Promise<null>((resolve) => 
            setTimeout(() => resolve(null), connectionTimeout)
          )
        ])
      )
    );
    
    // Collect successful connections from settled promises
    for (let i = 0; i < parallelResults.length; i++) {
      const result = parallelResults[i];
      if (result.status === 'fulfilled' && result.value) {
        connectedDevices.push(result.value);
      }
    }
    
    // If parallel connections didn't work well, try sequential fallback for remaining devices
    if (connectedDevices.length < config.devices.length) {
      console.log(`[Main] Parallel connections: ${connectedDevices.length}/${config.devices.length} succeeded`);
      console.log(`[Main] Attempting sequential connections for remaining devices...`);
      
      // Find which device configs are already connected
      const connectedIds = new Set<string>();
      for (const deviceConfig of config.devices) {
        const device = bleManager.getDevice(deviceConfig.id);
        if (device && connectedDevices.includes(device)) {
          connectedIds.add(deviceConfig.id);
        }
      }
      
      // Sequential fallback: try connecting remaining devices one at a time
      // Note: If adapter doesn't support concurrent connections, only the first device will work
      for (let i = 0; i < config.devices.length; i++) {
        const deviceConfig = config.devices[i];
        
        // Skip if already connected
        if (connectedIds.has(deviceConfig.id)) {
          continue;
        }
        
        const peripheral = scannedPeripherals.get(deviceConfig.id);
        if (!peripheral) {
          continue;
        }
        
        // If we already have a connected device, warn that concurrent connections may not be supported
        if (connectedDevices.length > 0) {
          console.log(`[Main] WARNING: Attempting to connect ${deviceConfig.name} while ${connectedDevices.length} device(s) already connected.`);
          console.log(`[Main] If this times out, the adapter likely doesn't support concurrent BLE connections.`);
          console.log(`[Main] Consider using a USB Bluetooth adapter or ESP32 BLE proxy for multiple devices.`);
        }
        
        // Add delay before attempting connection
        if (connectedDevices.length > 0) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
        console.log(`[Main] Connecting to ${deviceConfig.name} (sequential fallback)...`);
        const device = await bleManager.connectDevice(deviceConfig, peripheral);
        
        if (device) {
          mqttBridge.registerDevice(device, deviceConfig);
          connectedDevices.push(device);
          const initialState = device.getState();
          mqttBridge.publishState(deviceConfig.id, initialState);
          console.log(`[Main] ✓ Successfully connected to ${deviceConfig.name}`);
        } else {
          console.error(`[Main] ✗ Failed to connect to ${deviceConfig.name}`);
          if (connectedDevices.length > 0) {
            console.error(`[Main] This confirms the adapter doesn't support concurrent BLE connections.`);
            console.error(`[Main] Only ${connectedDevices.length} device(s) will be available.`);
          }
        }
      }
    } else {
      console.log(`[Main] ✓ All ${connectedDevices.length} devices connected successfully in parallel!`);
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
