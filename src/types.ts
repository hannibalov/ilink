export interface LightState {
  power: boolean;
  brightness: number; // 0-100
  color?: { r: number; g: number; b: number };
  colorTemperature?: number; // 0-100
}

export interface DeviceConfig {
  id: string;
  name: string;
  macAddress: string;
  targetChar?: string; // Default: 'a040'
  statusChar?: string; // Default: 'a042'
}

export interface MQTTCommand {
  state?: 'ON' | 'OFF';
  brightness?: number; // 0-255 (Home Assistant uses 0-255)
  color?: {
    r: number;
    g: number;
    b: number;
  };
  color_temp?: number; // Mireds (Home Assistant format)
}

export interface MQTTState {
  state: 'ON' | 'OFF';
  brightness?: number; // 0-255
  color?: {
    r: number;
    g: number;
    b: number;
  };
  color_temp?: number;
}
