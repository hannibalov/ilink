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
      
      console.log(`[Device] Attempting to connect to ${this.config.name}...`);
      console.log(`[Device] Peripheral ID: ${peripheral.id}, Address: ${peripheral.address}, State: ${peripheral.state}`);
      
      // Check if already connected
      if (peripheral.state === 'connected') {
        console.log(`[Device] ${this.config.name} is already connected`);
      } else {
        // Connect to peripheral with timeout
        console.log(`[Device] Current peripheral state: ${peripheral.state}`);
        const connectPromise = peripheral.connectAsync();
        const timeoutPromise = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout after 15 seconds')), 15000)
        );
        
        try {
          await Promise.race([connectPromise, timeoutPromise]);
          console.log(`[Device] Bluetooth connection established for ${this.config.name}`);
        } catch (timeoutError) {
          console.error(`[Device] Connection timeout for ${this.config.name}`);
          throw timeoutError;
        }
      }

      // Set up disconnect handler immediately to catch early disconnections
      let disconnected = false;
      const disconnectHandler = () => {
        console.warn(`[Device] ${this.config.name} disconnected unexpectedly`);
        disconnected = true;
      };
      this.peripheral.once('disconnect', disconnectHandler);

      // Start service discovery immediately - some devices disconnect if we wait
      // The connection is already established, so we can proceed right away
      console.log(`[Device] Connection established, starting service discovery immediately...`);
      
      // Quick check to ensure we're still connected
      if (disconnected || !this.peripheral || this.peripheral.state !== 'connected') {
        this.peripheral?.removeListener('disconnect', disconnectHandler);
        console.error(`[Device] Peripheral disconnected immediately after connection for ${this.config.name}`);
        console.error(`[Device] Peripheral state: ${this.peripheral?.state || 'null'}, disconnected flag: ${disconnected}`);
        throw new Error('Peripheral disconnected immediately after connection');
      }

      // Remove the temporary disconnect handler - we'll set up a proper one after discovery
      if (this.peripheral && typeof this.peripheral.removeListener === 'function') {
        this.peripheral.removeListener('disconnect', disconnectHandler);
      }

      // Discover only the iLink service and characteristics we need
      // This is much faster and more reliable than discovering all services
      const iLinkServiceUuid = 'a032';
      const targetCharUuid = this.config.targetChar || 'a040';
      const statusCharUuid = this.config.statusChar || 'a042';
      
      console.log(`[Device] Discovering iLink service (${iLinkServiceUuid}) and characteristics for ${this.config.name}...`);
      console.log(`[Device] Looking for characteristics: ${targetCharUuid} (target), ${statusCharUuid} (status)`);
      console.log(`[Device] Peripheral state before discovery: ${this.peripheral.state}`);
      console.log(`[Device] Peripheral ID: ${this.peripheral.id}, Address: ${this.peripheral.address}`);
      
      let characteristics: Characteristic[] = [];
      const maxRetries = 3;
      let lastError: Error | null = null;
      
      // Timeout for service discovery on Linux - discovering all services can take time
      const discoveryTimeout = 20000; // 20 seconds for full service discovery on Linux
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          if (attempt > 1) {
            console.log(`[Device] Retry attempt ${attempt}/${maxRetries} for service discovery...`);
            // Verify still connected before retry
            if (!this.peripheral || this.peripheral.state !== 'connected') {
              console.error(`[Device] Peripheral disconnected before retry, attempting reconnect...`);
              // Try to reconnect
              try {
                await this.peripheral.connectAsync();
                console.log(`[Device] Reconnected successfully`);
                // Wait a moment after reconnect
                await new Promise(resolve => setTimeout(resolve, 1000));
              } catch (reconnectError) {
                throw new Error(`Reconnection failed: ${reconnectError instanceof Error ? reconnectError.message : String(reconnectError)}`);
              }
            } else {
              // Wait a bit before retry
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
          
          // On Linux, discoverSomeServicesAndCharacteristicsAsync can cause disconnections
          // So we use discoverAllServicesAndCharacteristicsAsync and filter for what we need
          // This is more reliable even if slightly slower
          console.log(`[Device] Discovering all services and characteristics (will filter for iLink)...`);
          const discoverPromise = this.peripheral.discoverAllServicesAndCharacteristicsAsync();
          const discoverTimeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Service discovery timeout after ${discoveryTimeout / 1000} seconds (attempt ${attempt}/${maxRetries})`)), discoveryTimeout)
          );
          
          const result = await Promise.race([discoverPromise, discoverTimeoutPromise]);
          const allCharacteristics = result.characteristics || [];
          
          // Filter for the characteristics we need (a040 and a042)
          const normalizedTargetChar = targetCharUuid.toLowerCase().replace(/-/g, '');
          const normalizedStatusChar = statusCharUuid.toLowerCase().replace(/-/g, '');
          
          characteristics = allCharacteristics.filter(c => {
            const uuid = c.uuid.toLowerCase().replace(/-/g, '');
            return uuid === normalizedTargetChar || uuid === normalizedStatusChar || uuid === targetCharUuid || uuid === statusCharUuid;
          });
          
          this.characteristics = characteristics; // Cache for later use
          console.log(`[Device] Found ${allCharacteristics.length} total characteristics, ${characteristics.length} iLink characteristics (${targetCharUuid}, ${statusCharUuid}) for ${this.config.name}`);
          
          if (characteristics.length > 0) {
            // Success - break out of retry loop
            break;
          } else {
            console.warn(`[Device] iLink characteristics not found. Available characteristics:`, allCharacteristics.map(c => c.uuid));
            throw new Error(`No iLink characteristics found (looking for ${targetCharUuid}, ${statusCharUuid})`);
          }
        } catch (discoverError) {
          lastError = discoverError instanceof Error ? discoverError : new Error(String(discoverError));
          console.error(`[Device] Service discovery attempt ${attempt} failed for ${this.config.name}:`, lastError.message);
          
          // Check if peripheral is still connected
          if (this.peripheral && this.peripheral.state !== 'connected') {
            console.error(`[Device] Peripheral disconnected during discovery attempt ${attempt}`);
            // Don't throw immediately - try to reconnect on next attempt
            if (attempt < maxRetries) {
              console.log(`[Device] Will attempt reconnection on next retry...`);
            } else {
              throw new Error(`Peripheral disconnected during service discovery: ${lastError.message}`);
            }
          }
          
          // If this was the last attempt, try fallback to full discovery
          if (attempt === maxRetries) {
            console.warn(`[Device] Specific service discovery failed, trying fallback to full discovery...`);
            try {
              const fallbackPromise = this.peripheral.discoverAllServicesAndCharacteristicsAsync();
              const fallbackTimeout = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Fallback discovery timeout')), 20000)
              );
              const fallbackResult = await Promise.race([fallbackPromise, fallbackTimeout]);
              characteristics = fallbackResult.characteristics || [];
              this.characteristics = characteristics;
              console.log(`[Device] Fallback discovery found ${characteristics.length} characteristics`);
              if (characteristics.length > 0) {
                break; // Success with fallback
              }
            } catch (fallbackError) {
              console.error(`[Device] Fallback discovery also failed:`, fallbackError instanceof Error ? fallbackError.message : String(fallbackError));
            }
            throw lastError;
          }
        }
      }
      
      if (!characteristics || characteristics.length === 0) {
        throw new Error('Service discovery failed: no characteristics found after retries');
      }
      
      // Find the target characteristic (we already have the UUIDs from above)
      const normalizedTargetChar = targetCharUuid.toLowerCase().replace(/-/g, '');
      
      console.log(`[Device] Looking for characteristic ${targetCharUuid} (normalized: ${normalizedTargetChar})`);
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

      // Also find and cache status characteristic if available
      const normalizedStatusChar = statusCharUuid.toLowerCase().replace(/-/g, '');
      const statusChar = characteristics.find(c => {
        const uuid = c.uuid.toLowerCase().replace(/-/g, '');
        return uuid === normalizedStatusChar || uuid === statusCharUuid;
      });

      if (statusChar && statusChar.properties?.includes('read')) {
        this.statusCharacteristic = statusChar;
        console.log(`[Device] Found status characteristic ${statusCharUuid} for ${this.config.name}`);
      } else {
        console.warn(`[Device] Status characteristic ${statusCharUuid} not found or not readable for ${this.config.name}`);
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
      console.log(`[Device] Reading initial state for ${this.config.name}...`);
      try {
        await this.readState();
        console.log(`[Device] Initial state read completed for ${this.config.name}`);
      } catch (readError) {
        console.warn(`[Device] Failed to read initial state for ${this.config.name}, but continuing:`, readError);
        // Don't fail the connection if state read fails
      }

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
    if (!this.statusCharacteristic) {
      console.log(`[Device] No status characteristic available for ${this.config.name}`);
      return null;
    }

    if (!this.peripheral || this.peripheral.state !== 'connected') {
      console.warn(`[Device] Cannot read state - ${this.config.name} not connected`);
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

    console.log(`[Device] Attempting to reconnect ${this.config.name} in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(async () => {
      // Reconnection logic would need access to the BLE manager
      // For now, we'll just log - the manager should handle reconnection
      console.log(`[Device] Reconnection attempt ${this.reconnectAttempts} for ${this.config.name}`);
    }, delay);
  }
}
