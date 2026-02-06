import { Peripheral, Characteristic } from '@abandonware/noble';
import { encodeILinkCommand, parseILinkStatus } from './encoding';
import { LightState, DeviceConfig, MQTTCommand } from './types';

export class ILinkDevice {
  private peripheral: Peripheral | null = null;
  private characteristic: Characteristic | null = null;
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

  async connect(peripheral: Peripheral): Promise<boolean> {
    try {
      this.peripheral = peripheral;
      
      console.log(`[Device] Attempting to connect to ${this.config.name}...`);
      
      // Connect to peripheral
      await peripheral.connectAsync();
      console.log(`[Device] Bluetooth connection established for ${this.config.name}`);

      // Discover services and characteristics
      const { characteristics } = await peripheral.discoverAllServicesAndCharacteristicsAsync();
      
      // Find the target characteristic (default: a040)
      const targetCharUuid = this.config.targetChar || 'a040';
      const normalizedTargetChar = targetCharUuid.toLowerCase().replace(/-/g, '');
      
      const char = characteristics.find(c => {
        const uuid = c.uuid.toLowerCase().replace(/-/g, '');
        return uuid === normalizedTargetChar || uuid === targetCharUuid;
      });

      if (!char) {
        console.error(`[Device] Characteristic ${targetCharUuid} not found for ${this.config.name}`);
        console.log(`[Device] Available characteristics:`, characteristics.map(c => c.uuid));
        await this.peripheral!.disconnectAsync();
        return false;
      }

      console.log(`[Device] Found characteristic ${targetCharUuid} for ${this.config.name}`);

      this.characteristic = char;
      this.reconnectAttempts = 0;

      // Set up disconnect handler
      peripheral.once('disconnect', () => {
        console.log(`[Device] ${this.config.name} disconnected`);
        this.characteristic = null;
        this.peripheral = null;
        this.attemptReconnect();
      });

      // Try to read initial state
      console.log(`[Device] Reading initial state for ${this.config.name}...`);
      await this.readState();

      console.log(`[Device] Successfully connected to ${this.config.name} (${this.config.id})`);
      return true;
    } catch (error) {
      console.error(`[Device] Failed to connect to ${this.config.name}:`, error);
      if (error instanceof Error) {
        console.error(`[Device] Error details: ${error.message}`);
        console.error(`[Device] Stack: ${error.stack}`);
      }
      // Try to disconnect if connection was partially established
      try {
        if (this.peripheral) {
          await this.peripheral.disconnectAsync();
        }
      } catch (disconnectError) {
        // Ignore disconnect errors
      }
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.peripheral) {
      try {
        await this.peripheral.disconnectAsync();
      } catch (error) {
        console.error(`[Device] Error disconnecting ${this.config.name}:`, error);
      }
      this.peripheral = null;
      this.characteristic = null;
    }
  }

  async sendCommand(command: MQTTCommand): Promise<boolean> {
    if (!this.characteristic) {
      console.error(`[Device] ${this.config.name} not connected`);
      return false;
    }

    try {
      let hexCommand = '';

      // Power command
      if (command.state !== undefined) {
        hexCommand = encodeILinkCommand('0805', command.state === 'ON' ? '01' : '00');
        this.state.power = command.state === 'ON';
      }

      // Brightness command (Home Assistant uses 0-255, convert to 0-100)
      if (command.brightness !== undefined) {
        const brightness = Math.min(255, Math.max(0, command.brightness));
        const brightnessPercent = Math.floor((brightness / 255) * 100);
        const brightnessHex = Math.floor((brightnessPercent / 100) * 255).toString(16).padStart(2, '0');
        hexCommand = encodeILinkCommand('0801', brightnessHex);
        this.state.brightness = brightnessPercent;
        this.state.power = true; // Brightness implies power on
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
        this.state.power = true; // Color implies power on
      }

      if (!hexCommand) {
        console.warn(`[Device] No command generated for ${this.config.name}`);
        return false;
      }

      const buffer = Buffer.from(hexCommand.replace(/\s/g, ''), 'hex');
      const withoutResponse = this.characteristic.properties?.includes('writeWithoutResponse') || false;

      await this.characteristic.writeAsync(buffer, withoutResponse);
      
      console.log(`[Device] Sent command to ${this.config.name}: ${hexCommand}`);
      
      // Update state and notify
      this.onStateUpdate({ ...this.state });

      return true;
    } catch (error) {
      console.error(`[Device] Failed to send command to ${this.config.name}:`, error);
      return false;
    }
  }

  async readState(): Promise<LightState | null> {
    if (!this.characteristic) {
      return null;
    }

    const statusCharUuid = this.config.statusChar || 'a042';
    const normalizedStatusChar = statusCharUuid.toLowerCase().replace(/-/g, '');

    try {
      // Find status characteristic
      const { characteristics } = await this.peripheral!.discoverAllServicesAndCharacteristicsAsync();
      const statusChar = characteristics.find(c => {
        const uuid = c.uuid.toLowerCase().replace(/-/g, '');
        return uuid === normalizedStatusChar || uuid === statusCharUuid;
      });

      if (!statusChar || !statusChar.properties?.includes('read')) {
        console.warn(`[Device] Status characteristic ${statusCharUuid} not found or not readable for ${this.config.name}`);
        return null;
      }

      const data = await statusChar.readAsync();
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
      console.error(`[Device] Failed to read state from ${this.config.name}:`, error);
    }

    return null;
  }

  getState(): LightState {
    return { ...this.state };
  }

  isConnected(): boolean {
    return this.characteristic !== null && this.peripheral !== null;
  }

  private async attemptReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`[Device] Max reconnect attempts reached for ${this.config.name}`);
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000); // Exponential backoff, max 30s

    console.log(`[Device] Attempting to reconnect ${this.config.name} in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(async () => {
      // Reconnection logic would need access to the BLE manager
      // For now, we'll just log - the manager should handle reconnection
      console.log(`[Device] Reconnection attempt ${this.reconnectAttempts} for ${this.config.name}`);
    }, delay);
  }
}
