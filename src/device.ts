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
      
      // Check peripheral state before attempting connection
      const initialState = peripheral.state;
      console.log(`[Device] Peripheral state for ${this.config.name}: ${initialState}`);
      
      // If peripheral is in an invalid state, we might need to wait or reset
      if (initialState === 'disconnecting') {
        console.log(`[Device] Waiting for ${this.config.name} to finish disconnecting...`);
        // Wait a bit for disconnection to complete
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      // Set up disconnect handler BEFORE connecting to catch early disconnections
      let disconnected = false;
      let disconnectReason: string | null = null;
      const disconnectHandler = (reason?: string) => {
        disconnected = true;
        disconnectReason = reason || 'Unknown reason';
        console.log(`[Device] Disconnect detected for ${this.config.name}: ${disconnectReason}`);
      };
      
      // Remove any existing disconnect listeners first
      if (this.peripheral && typeof this.peripheral.removeAllListeners === 'function') {
        this.peripheral.removeAllListeners('disconnect');
      }
      
      // Set up disconnect handler before connecting
      this.peripheral.once('disconnect', disconnectHandler);

      // Check if already connected
      if (peripheral.state !== 'connected') {
        console.log(`[Device] Connecting to ${this.config.name} (current state: ${peripheral.state})...`);
        
        // On Raspberry Pi, sometimes we need to ensure the peripheral is ready
        // Wait a small amount if state is 'disconnected' to let it settle
        if (peripheral.state === 'disconnected') {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        const connectPromise = peripheral.connectAsync();
        // Increased timeout to 60 seconds for Raspberry Pi - BLE connections can take longer
        // especially when the Bluetooth stack is busy or devices are further away
        const timeoutPromise = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout after 60 seconds')), 60000)
        );
        
        await Promise.race([connectPromise, timeoutPromise]);
        console.log(`[Device] Connection established to ${this.config.name}`);
      } else {
        console.log(`[Device] ${this.config.name} already connected`);
      }

      // Verify connection state immediately after connect
      if (disconnected || !this.peripheral || this.peripheral.state !== 'connected') {
        const reason = disconnectReason ? ` (${disconnectReason})` : '';
        throw new Error(`Peripheral disconnected immediately after connection${reason}`);
      }

      // OPTIMIZED FOR CONCURRENT CONNECTIONS: Force immediate GATT activity after connection
      // macOS CoreBluetooth sends implicit MTU exchange and GATT traffic immediately
      // BlueZ does NOT - this causes Error 62 (Connection Failed to be Established)
      // For concurrent connections, we need to establish GATT quickly to prevent timeout
      console.log(`[Device] Connection established, forcing immediate GATT activity for ${this.config.name}`);

      // Remove the temporary disconnect handler - we'll set up a proper one after discovery
      if (this.peripheral && typeof this.peripheral.removeListener === 'function') {
        this.peripheral.removeListener('disconnect', disconnectHandler);
      }

      // Step 1: Try MTU exchange immediately (if supported by noble)
      // This is what macOS does implicitly and BlueZ doesn't
      // For concurrent connections, use a smaller MTU (185) to reduce controller load
      // This allows the adapter to handle multiple connections more efficiently
      try {
        if (this.peripheral && typeof (this.peripheral as any).exchangeMtu === 'function') {
          console.log(`[Device] Exchanging MTU for ${this.config.name} (optimized for concurrency)...`);
          // Use 185 instead of 247 to reduce controller load for concurrent connections
          const optimizedMtu = 185;
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('MTU exchange timeout'));
            }, 2000);
            
            try {
              (this.peripheral as any).exchangeMtu(optimizedMtu, (error?: Error) => {
                clearTimeout(timeout);
                if (error) {
                  console.warn(`[Device] MTU exchange failed (non-fatal): ${error.message}`);
                  resolve(); // Continue anyway
                } else {
                  console.log(`[Device] MTU exchange successful for ${this.config.name} (MTU: ${optimizedMtu})`);
                  resolve();
                }
              });
            } catch (err) {
              clearTimeout(timeout);
              console.warn(`[Device] MTU exchange not available (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
              resolve(); // Continue anyway
            }
          });
        } else {
          console.log(`[Device] MTU exchange not available on this platform, skipping...`);
        }
      } catch (mtuError) {
        // Non-fatal - continue with discovery
        console.warn(`[Device] MTU exchange error (non-fatal): ${mtuError instanceof Error ? mtuError.message : String(mtuError)}`);
      }
      
      // Step 2: Small delay to let MTU exchange complete before GATT discovery
      // This helps prevent connection parameter conflicts when multiple devices connect
      await new Promise(resolve => setTimeout(resolve, 100));

      // Discover services and characteristics
      // IMPORTANT: Start discovery immediately after connection to prevent timeout (error 62)
      const iLinkServiceUuid = 'a032';
      const targetCharUuid = this.config.targetChar || 'a040';
      const statusCharUuid = this.config.statusChar || 'a042';
      
      console.log(`[Device] Starting service discovery immediately for ${this.config.name}...`);
      
      let characteristics: Characteristic[] = [];
      const maxRetries = 5; // Increased retries for Raspberry Pi
      let lastError: Error | null = null;
      
      // Timeout for service discovery on Linux - discovering all services can take time
      // Increased timeout for Raspberry Pi which can be slower
      const discoveryTimeout = 30000; // 30 seconds for full service discovery on Linux/Raspberry Pi
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          if (attempt > 1) {
            console.log(`[Device] Retry attempt ${attempt}/${maxRetries} for service discovery...`);
            // Wait before retry - longer delay for later attempts
            const retryDelay = Math.min(1000 * attempt, 3000);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            
            // Verify still connected - if not, we need a fresh peripheral reference
            if (!this.peripheral || this.peripheral.state !== 'connected') {
              throw new Error('Peripheral disconnected - need fresh reference');
            }
          }
          
          // Verify connection before starting discovery
          if (!this.peripheral || this.peripheral.state !== 'connected') {
            throw new Error('Peripheral not connected before discovery');
          }
          
          // CRITICAL: Start discovery immediately - no delays!
          // The device will disconnect (error 62) if it doesn't receive GATT requests quickly
          
          // OPTIMIZED: Discover ONLY the specific iLink service (a032) with optimized timeout
          // For concurrent connections, use slightly longer timeout but still fail-fast
          // This balances between allowing time for controller scheduling and preventing hangs
          const services = await new Promise<any[]>((resolve, reject) => {
            // Check connection state before starting discovery
            if (!this.peripheral || this.peripheral.state !== 'connected') {
              reject(new Error('Peripheral disconnected before service discovery'));
              return;
            }
            
            // Optimized timeout for concurrent connections: 5 seconds
            // Longer than single connection (3s) to account for controller scheduling
            // But still short enough to fail-fast and retry
            const shortTimeout = 5000; // 5 seconds - optimized for concurrent connections
            
            const timeout = setTimeout(() => {
              // Check if still connected when timeout occurs
              if (!this.peripheral || this.peripheral.state !== 'connected') {
                reject(new Error('Peripheral disconnected during service discovery timeout'));
              } else {
                reject(new Error(`Service discovery timeout after ${shortTimeout / 1000} seconds`));
              }
            }, shortTimeout);
            
            // Discover ONLY the iLink service UUID (a032) - much faster than discovering all services
            try {
              // Normalize the service UUID (remove dashes, ensure lowercase)
              const normalizedServiceUuid = iLinkServiceUuid.toLowerCase().replace(/-/g, '');
              
              this.peripheral!.discoverServices([normalizedServiceUuid], (error: string | null, discoveredServices: any[]) => {
                clearTimeout(timeout);
                // Check connection state in callback
                if (!this.peripheral || this.peripheral.state !== 'connected') {
                  reject(new Error('Peripheral disconnected during service discovery'));
                  return;
                }
                if (error) {
                  reject(new Error(`Service discovery failed: ${error}`));
                } else {
                  // Filter to ensure we got the right service
                  const filteredServices = (discoveredServices || []).filter((s: any) => {
                    const uuid = s.uuid.toLowerCase().replace(/-/g, '');
                    return uuid === normalizedServiceUuid || uuid.includes(normalizedServiceUuid);
                  });
                  
                  if (filteredServices.length === 0) {
                    reject(new Error(`iLink service ${iLinkServiceUuid} not found`));
                  } else {
                    resolve(filteredServices);
                  }
                }
              });
            } catch (err) {
              clearTimeout(timeout);
              reject(new Error(`Failed to start service discovery: ${err instanceof Error ? err.message : String(err)}`));
            }
          });
          
          console.log(`[Device] Found ${services.length} service(s), discovering characteristics...`);
          
          // Discover characteristics for the service - also with short timeout
          const allCharacteristics: Characteristic[] = [];
          
          // Check connection before discovering characteristics
          if (!this.peripheral || this.peripheral.state !== 'connected') {
            throw new Error('Peripheral disconnected before characteristic discovery');
          }
          
          for (const service of services) {
            try {
              // Check connection before each service
              if (!this.peripheral || this.peripheral.state !== 'connected') {
                throw new Error('Peripheral disconnected during characteristic discovery');
              }
              
              const serviceChars = await new Promise<Characteristic[]>((resolve, reject) => {
                // Optimized timeout for concurrent connections: 5 seconds
                // Allows controller time to schedule between multiple devices
                const shortCharTimeout = 5000; // 5 seconds - optimized for concurrent connections
                const timeout = setTimeout(() => {
                  if (!this.peripheral || this.peripheral.state !== 'connected') {
                    reject(new Error('Peripheral disconnected during characteristic discovery timeout'));
                  } else {
                    reject(new Error(`Characteristic discovery timeout for service ${service.uuid}`));
                  }
                }, shortCharTimeout);
                
                try {
                  service.discoverCharacteristics([], (error: string | null, chars: Characteristic[]) => {
                    clearTimeout(timeout);
                    if (!this.peripheral || this.peripheral.state !== 'connected') {
                      reject(new Error('Peripheral disconnected during characteristic discovery'));
                      return;
                    }
                    if (error) {
                      reject(new Error(`Characteristic discovery failed: ${error}`));
                    } else {
                      resolve(chars || []);
                    }
                  });
                } catch (err) {
                  clearTimeout(timeout);
                  reject(new Error(`Failed to start characteristic discovery: ${err instanceof Error ? err.message : String(err)}`));
                }
              });
              
              allCharacteristics.push(...serviceChars);
            } catch (charError) {
              console.warn(`[Device] Failed to discover characteristics for service ${service.uuid}:`, charError instanceof Error ? charError.message : String(charError));
              if (charError instanceof Error && charError.message.includes('disconnected')) {
                throw charError; // Re-throw disconnection errors
              }
            }
          }
          
          console.log(`[Device] Found ${allCharacteristics.length} characteristic(s)`);
          
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[Device] Failed to connect to ${this.config.name}: ${errorMessage}`);
      
      // Log additional debugging info
      if (this.peripheral) {
        console.error(`[Device] Peripheral state: ${this.peripheral.state}`);
        console.error(`[Device] Peripheral ID: ${this.peripheral.id}`);
        console.error(`[Device] Peripheral address: ${this.peripheral.address}`);
      }
      
      // Try to disconnect if connection was partially established
      try {
        if (this.peripheral && this.peripheral.state === 'connected') {
          await this.peripheral.disconnectAsync();
        }
      } catch (disconnectError) {
        // Ignore disconnect errors
      }
      
      // Re-throw the error so the BLE manager can handle retries
      throw error;
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
