import { Peripheral, Characteristic } from '@abandonware/noble';
import { encodeILinkCommand, parseILinkStatus } from './encoding';
import { LightState, DeviceConfig, MQTTCommand } from './types';

export class ILinkDevice {
  private peripheral: Peripheral | null = null;
  private characteristic: Characteristic | null = null;
  private statusCharacteristic: Characteristic | null = null;
  private characteristics: Characteristic[] = [];
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
      // Store peripheral reference immediately
      this.peripheral = peripheral;
      
      // Check if already connected
      if (peripheral.state !== 'connected') {
        const connectPromise = peripheral.connectAsync();
        const timeoutPromise = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout after 15 seconds')), 15000)
        );
        
        await Promise.race([connectPromise, timeoutPromise]);
      }

      // Set up disconnect handler immediately to catch early disconnections
      let disconnected = false;
      const disconnectHandler = () => {
        disconnected = true;
      };
      this.peripheral.once('disconnect', disconnectHandler);

      // Quick check to ensure we're still connected
      if (disconnected || !this.peripheral || this.peripheral.state !== 'connected') {
        this.peripheral?.removeListener('disconnect', disconnectHandler);
        throw new Error('Peripheral disconnected immediately after connection');
      }

      // Remove the temporary disconnect handler - we'll set up a proper one after discovery
      if (this.peripheral && typeof this.peripheral.removeListener === 'function') {
        this.peripheral.removeListener('disconnect', disconnectHandler);
      }

      // Discover services and characteristics
      const iLinkServiceUuid = 'a032';
      const targetCharUuid = this.config.targetChar || 'a040';
      const statusCharUuid = this.config.statusChar || 'a042';
      
      console.log(`[Device] Discovering services and characteristics for ${this.config.name}...`);
      
      let characteristics: Characteristic[] = [];
      const maxRetries = 3;
      let lastError: Error | null = null;
      
      // Timeout for service discovery on Linux - discovering all services can take time
      const discoveryTimeout = 20000; // 20 seconds for full service discovery on Linux
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          if (attempt > 1) {
            console.log(`[Device] Retry attempt ${attempt}/${maxRetries} for service discovery...`);
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Verify still connected - if not, we need a fresh peripheral reference
            if (!this.peripheral || this.peripheral.state !== 'connected') {
              throw new Error('Peripheral disconnected - need fresh reference');
            }
          }
          
          // Verify connection before starting discovery
          if (!this.peripheral || this.peripheral.state !== 'connected') {
            throw new Error('Peripheral not connected before discovery');
          }
          
          // On Linux, discoverAllServicesAndCharacteristicsAsync() hangs indefinitely
          // Use the callback-based two-step approach from peripheral-explorer.js:
          // 1. Discover services first (callback-based, more reliable on Linux)
          // 2. Then discover characteristics for each service
          const services = await new Promise<any[]>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error(`Service discovery timeout after ${discoveryTimeout / 1000} seconds`));
            }, discoveryTimeout);
            
            // Use callback-based discoverServices - more reliable on Linux
            this.peripheral!.discoverServices([], (error: string | null, discoveredServices: any[]) => {
              clearTimeout(timeout);
              if (error) {
                reject(new Error(`Service discovery failed: ${error}`));
              } else {
                resolve(discoveredServices || []);
              }
            });
          });
          
          console.log(`[Device] Found ${services.length} service(s), discovering characteristics...`);
          
          // Discover characteristics for all services (we'll filter later)
          const allCharacteristics: Characteristic[] = [];
          
          for (const service of services) {
            try {
              const serviceChars = await new Promise<Characteristic[]>((resolve, reject) => {
                const timeout = setTimeout(() => {
                  reject(new Error(`Characteristic discovery timeout for service ${service.uuid}`));
                }, discoveryTimeout);
                
                service.discoverCharacteristics([], (error: string | null, chars: Characteristic[]) => {
                  clearTimeout(timeout);
                  if (error) {
                    reject(new Error(`Characteristic discovery failed: ${error}`));
                  } else {
                    resolve(chars || []);
                  }
                });
              });
              
              allCharacteristics.push(...serviceChars);
            } catch (charError) {
              console.warn(`[Device] Failed to discover characteristics for service ${service.uuid}:`, charError instanceof Error ? charError.message : String(charError));
              // Continue with other services
            }
          }
          
          // Filter for the characteristics we need (a040 and a042)
          const normalizedTargetChar = targetCharUuid.toLowerCase().replace(/-/g, '');
          const normalizedStatusChar = statusCharUuid.toLowerCase().replace(/-/g, '');
          
          characteristics = allCharacteristics.filter(c => {
            const uuid = c.uuid.toLowerCase().replace(/-/g, '');
            return uuid === normalizedTargetChar || uuid === normalizedStatusChar || uuid === targetCharUuid || uuid === statusCharUuid;
          });
          
          this.characteristics = characteristics; // Cache for later use
          
          if (characteristics.length > 0) {
            console.log(`[Device] Found ${characteristics.length} iLink characteristics for ${this.config.name}`);
            // Success - break out of retry loop
            break;
          } else {
            console.warn(`[Device] iLink characteristics not found. Available:`, allCharacteristics.map(c => c.uuid));
            throw new Error(`No iLink characteristics found (looking for ${targetCharUuid}, ${statusCharUuid})`);
          }
        } catch (discoverError) {
          lastError = discoverError instanceof Error ? discoverError : new Error(String(discoverError));
          console.error(`[Device] Service discovery attempt ${attempt} failed: ${lastError.message}`);
          
          // Check if peripheral is still connected
          if (this.peripheral && this.peripheral.state !== 'connected') {
            if (attempt === maxRetries) {
              throw new Error(`Peripheral disconnected during service discovery: ${lastError.message}`);
            }
            // For retries, we'll need a fresh peripheral reference - throw to let caller handle
            throw new Error('Peripheral disconnected - need fresh reference');
          }
          
          // If this was the last attempt, provide helpful error message
          if (attempt === maxRetries) {
            console.error(`[Device] All ${maxRetries} service discovery attempts failed`);
            console.error(`[Device] Troubleshooting: Check for multiple HCI devices (sudo ./scripts/check-bluetooth.sh)`);
            throw lastError;
          }
        }
      }
      
      if (!characteristics || characteristics.length === 0) {
        throw new Error('Service discovery failed: no characteristics found after retries');
      }
      
      // Find the target characteristic
      const normalizedTargetChar = targetCharUuid.toLowerCase().replace(/-/g, '');
      const char = characteristics.find(c => {
        const uuid = c.uuid.toLowerCase().replace(/-/g, '');
        return uuid === normalizedTargetChar || uuid === targetCharUuid;
      });

      if (!char) {
        console.error(`[Device] Characteristic ${targetCharUuid} not found. Available:`, characteristics.map(c => c.uuid));
        await this.peripheral!.disconnectAsync();
        return false;
      }

      this.characteristic = char;

      // Also find and cache status characteristic if available
      const normalizedStatusChar = statusCharUuid.toLowerCase().replace(/-/g, '');
      const statusChar = characteristics.find(c => {
        const uuid = c.uuid.toLowerCase().replace(/-/g, '');
        return uuid === normalizedStatusChar || uuid === statusCharUuid;
      });

      if (statusChar && statusChar.properties?.includes('read')) {
        this.statusCharacteristic = statusChar;
      } else {
        console.warn(`[Device] Status characteristic ${statusCharUuid} not available for ${this.config.name}`);
      }

      this.reconnectAttempts = 0;

      // Set up disconnect handler
      this.peripheral.once('disconnect', () => {
        console.log(`[Device] ${this.config.name} disconnected`);
        this.characteristic = null;
        this.peripheral = null;
        this.attemptReconnect();
      });

      // Try to read initial state
      try {
        await this.readState();
      } catch (readError) {
        // Don't fail the connection if state read fails
      }

      console.log(`[Device] Successfully connected to ${this.config.name}`);
      return true;
    } catch (error) {
      console.error(`[Device] Failed to connect to ${this.config.name}:`, error instanceof Error ? error.message : String(error));
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
      
      // Update state and notify
      this.onStateUpdate({ ...this.state });

      return true;
    } catch (error) {
      console.error(`[Device] Failed to send command to ${this.config.name}:`, error);
      return false;
    }
  }

  async readState(): Promise<LightState | null> {
    if (!this.statusCharacteristic || !this.peripheral || this.peripheral.state !== 'connected') {
      return null;
    }

    try {
      const data = await this.statusCharacteristic.readAsync();
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

    setTimeout(async () => {
      // Reconnection logic would need access to the BLE manager
      // The manager should handle reconnection
    }, delay);
  }
}
