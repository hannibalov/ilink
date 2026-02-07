/**
 * Alternative Device implementation using node-ble library
 * This provides better BlueZ integration and concurrent connection support
 */

import { encodeILinkCommand, parseILinkStatus } from './encoding';
import { LightState, DeviceConfig, MQTTCommand } from './types';

export class ILinkDeviceNodeBle {
  private device: any = null;
  private gattServer: any = null;
  private service: any = null;
  private characteristic: any = null;
  private statusCharacteristic: any = null;
  private state: LightState = {
    power: false,
    brightness: 100,
  };
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(
    private config: DeviceConfig,
    private onStateUpdate: (state: LightState) => void
  ) {}

  async connect(device: any): Promise<boolean> {
    try {
      this.device = device;
      
      console.log(`[Device-NodeBle] Connecting to ${this.config.name}...`);
      
      // Connect to device
      await this.device.connect();
      console.log(`[Device-NodeBle] Connected to ${this.config.name}`);
      
      // Get GATT server
      this.gattServer = await this.device.gatt();
      
      // Discover iLink service (a032)
      const iLinkServiceUuid = 'a032';
      const targetCharUuid = this.config.targetChar || 'a040';
      const statusCharUuid = this.config.statusChar || 'a042';
      
      console.log(`[Device-NodeBle] Discovering service ${iLinkServiceUuid}...`);
      
      // Get primary service
      this.service = await this.gattServer.getPrimaryService(iLinkServiceUuid);
      
      if (!this.service) {
        throw new Error(`iLink service ${iLinkServiceUuid} not found`);
      }
      
      console.log(`[Device-NodeBle] Service found, discovering characteristics...`);
      
      // Get characteristics
      const characteristics = await this.service.characteristics();
      
      // Find target and status characteristics
      const normalizedTargetChar = targetCharUuid.toLowerCase().replace(/-/g, '');
      const normalizedStatusChar = statusCharUuid.toLowerCase().replace(/-/g, '');
      
      for (const char of characteristics) {
        const uuid = char.uuid.toLowerCase().replace(/-/g, '');
        if (uuid === normalizedTargetChar || uuid === targetCharUuid) {
          this.characteristic = char;
          console.log(`[Device-NodeBle] Found target characteristic: ${uuid}`);
        }
        if (uuid === normalizedStatusChar || uuid === statusCharUuid) {
          this.statusCharacteristic = char;
          console.log(`[Device-NodeBle] Found status characteristic: ${uuid}`);
        }
      }
      
      if (!this.characteristic) {
        throw new Error(`Target characteristic ${targetCharUuid} not found`);
      }
      
      // Try to read initial state
      try {
        await this.readState();
      } catch (readError) {
        // Don't fail the connection if state read fails
        console.warn(`[Device-NodeBle] Failed to read initial state: ${readError}`);
      }
      
      this.reconnectAttempts = 0;
      console.log(`[Device-NodeBle] Successfully connected to ${this.config.name}`);
      return true;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[Device-NodeBle] Failed to connect to ${this.config.name}: ${errorMessage}`);
      
      // Clean up on failure
      try {
        if (this.device) {
          await this.device.disconnect();
        }
      } catch (disconnectError) {
        // Ignore disconnect errors
      }
      
      this.device = null;
      this.gattServer = null;
      this.service = null;
      this.characteristic = null;
      this.statusCharacteristic = null;
      
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.device) {
      try {
        await this.device.disconnect();
      } catch (error) {
        console.error(`[Device-NodeBle] Error disconnecting ${this.config.name}:`, error);
      }
      this.device = null;
      this.gattServer = null;
      this.service = null;
      this.characteristic = null;
      this.statusCharacteristic = null;
    }
  }

  async sendCommand(command: MQTTCommand): Promise<boolean> {
    if (!this.characteristic) {
      console.error(`[Device-NodeBle] ${this.config.name} not connected`);
      return false;
    }

    try {
      let hexCommand = '';

      // Power command
      if (command.state !== undefined) {
        hexCommand = encodeILinkCommand('0805', command.state === 'ON' ? '01' : '00');
        this.state.power = command.state === 'ON';
      }

      // Brightness command
      if (command.brightness !== undefined) {
        const brightness = Math.min(255, Math.max(0, command.brightness));
        const brightnessPercent = Math.floor((brightness / 255) * 100);
        const brightnessHex = Math.floor((brightnessPercent / 100) * 255).toString(16).padStart(2, '0');
        hexCommand = encodeILinkCommand('0801', brightnessHex);
        this.state.brightness = brightnessPercent;
        this.state.power = true;
      }

      // Color command
      if (command.color) {
        const { r, g, b } = command.color;
        const colorHex = 
          r.toString(16).padStart(2, '0') +
          g.toString(16).padStart(2, '0') +
          b.toString(16).padStart(2, '0');
        hexCommand = encodeILinkCommand('0802', colorHex);
        this.state.color = { r, g, b };
        this.state.power = true;
      }

      if (!hexCommand) {
        console.warn(`[Device-NodeBle] No command generated for ${this.config.name}`);
        return false;
      }

      const buffer = Buffer.from(hexCommand.replace(/\s/g, ''), 'hex');
      
      // Write to characteristic
      await this.characteristic.writeValue(buffer);
      
      // Update state and notify
      this.onStateUpdate({ ...this.state });

      return true;
    } catch (error) {
      console.error(`[Device-NodeBle] Failed to send command to ${this.config.name}:`, error);
      return false;
    }
  }

  async readState(): Promise<LightState | null> {
    if (!this.statusCharacteristic) {
      return null;
    }

    try {
      const data = await this.statusCharacteristic.readValue();
      const hex = data.toString('hex');
      const parsed = parseILinkStatus(hex);

      if (Object.keys(parsed).length > 0) {
        this.state = {
          ...this.state,
          ...parsed,
        };
        this.onStateUpdate({ ...this.state });
        return this.state;
      }
    } catch (error) {
      console.error(`[Device-NodeBle] Failed to read state from ${this.config.name}:`, error);
    }

    return null;
  }

  getState(): LightState {
    return { ...this.state };
  }

  isConnected(): boolean {
    return this.characteristic !== null && this.device !== null;
  }
}
