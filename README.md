# iLink Home Assistant Integration

A Node.js/TypeScript bridge that connects iLink Bluetooth lights to Home Assistant via MQTT.

## Overview

This integration allows you to control iLink Bluetooth lights from Home Assistant using the native MQTT Light integration. The bridge:

- Connects to iLink devices via Bluetooth Low Energy (BLE)
- Subscribes to MQTT command topics from Home Assistant
- Publishes device state updates to MQTT
- Handles device reconnection and error recovery

## Prerequisites

- Node.js 18+ and npm/yarn
- Bluetooth adapter (for BLE communication)
- MQTT broker (e.g., Mosquitto)
- Home Assistant with MQTT integration configured

### Linux (Raspberry Pi)

```bash
# Install Bluetooth libraries
sudo apt-get update
sudo apt-get install -y bluetooth bluez libbluetooth-dev

# Install MQTT broker (Mosquitto)
sudo apt-get install -y mosquitto mosquitto-clients
sudo systemctl start mosquitto
sudo systemctl enable mosquitto
```

### macOS

```bash
# Install via Homebrew
brew install mosquitto
brew services start mosquitto
```

## Installation

1. Clone or navigate to this directory:
```bash
cd ilink
```

2. Install dependencies:
```bash
npm install
# or
yarn install
```

3. Build the TypeScript code:
```bash
npm run build
# or
yarn build
```

## Configuration

1. Copy the example environment file:
```bash
cp .env.example .env
```

2. Edit `.env` with your configuration:

```env
# MQTT Broker Configuration
MQTT_BROKER_URL=mqtt://localhost:1883
MQTT_USERNAME=  # Optional
MQTT_PASSWORD=  # Optional
MQTT_BASE_TOPIC=ilink

# Device Configuration (JSON array)
# Each device needs a unique "id" - this is used in MQTT topics
DEVICES=[
  {
    "id": "living_room",
    "name": "Living Room Light",
    "macAddress": "aa:bb:cc:dd:ee:ff",
    "targetChar": "a040",
    "statusChar": "a042"
  },
  {
    "id": "bedroom",
    "name": "Bedroom Light",
    "macAddress": "11:22:33:44:55:66",
    "targetChar": "a040",
    "statusChar": "a042"
  }
]
```

**Important:** Each device must have a **unique `id`**. This `id` is used to create MQTT topics:
- Command topic: `ilink/{id}/set`
- State topic: `ilink/{id}/state`

Home Assistant uses these topics to distinguish between devices. Make sure each device has a different `id`!

### Finding Device MAC Addresses

To find your iLink device MAC addresses:

**Option 1: Use the built-in scan script (recommended)**
```bash
# On Linux/Raspberry Pi, you'll need sudo:
sudo npm run scan

# Press Ctrl+C when done scanning
# The script will output a JSON snippet you can copy to your .env file
```

**Option 2: Use system Bluetooth tools**
```bash
# Linux
sudo hcitool lescan

# Or using bluetoothctl
bluetoothctl
scan on
# Wait for devices, then:
devices
exit
```

### Device Configuration Fields

- `id`: **Unique identifier for the device** (used in MQTT topics) - **Must be unique for each device!**
  - Examples: `"living_room"`, `"bedroom"`, `"kitchen_light"`
  - Used in MQTT topics: `ilink/{id}/set` and `ilink/{id}/state`
  - Home Assistant uses this to distinguish between devices
- `name`: Friendly name (for logging and display)
- `macAddress`: Bluetooth MAC address of the device (must be unique per physical device)
- `targetChar`: Characteristic UUID for writing commands (default: `a040`)
- `statusChar`: Characteristic UUID for reading status (default: `a042`)

### Multiple Devices

When you have multiple iLink devices, each one needs:
1. **Unique `id`** - This is how Home Assistant distinguishes them
2. **Unique `macAddress`** - The physical Bluetooth address
3. **Corresponding Home Assistant configuration** - One light entity per device

Example with 2 devices:

**.env file:**
```env
DEVICES=[
  {"id":"living_room","name":"Living Room","macAddress":"aa:bb:cc:dd:ee:ff"},
  {"id":"bedroom","name":"Bedroom","macAddress":"11:22:33:44:55:66"}
]
```

**Home Assistant configuration.yaml:**
```yaml
light:
  - platform: mqtt
    name: "Living Room Light"
    unique_id: "ilink_living_room"
    state_topic: "ilink/living_room/state"
    command_topic: "ilink/living_room/set"
    brightness: true
    rgb: true
    schema: json
    optimistic: false
    qos: 1
    retain: true

  - platform: mqtt
    name: "Bedroom Light"
    unique_id: "ilink_bedroom"
    state_topic: "ilink/bedroom/state"
    command_topic: "ilink/bedroom/set"
    brightness: true
    rgb: true
    schema: json
    optimistic: false
    qos: 1
    retain: true
```

Notice how the `id` in the `.env` file matches the topic names in Home Assistant!

## Running

### First Time Setup

After installing dependencies, build the TypeScript code:

```bash
npm run build
# or
yarn build
```

### Development Mode

Runs TypeScript directly without building (good for development):

```bash
npm run dev
# or
yarn dev
```

### Production Mode

Builds and runs the compiled JavaScript:

```bash
npm start
# or
yarn start
```

**Note:** `npm start` will automatically build if needed, but it's faster to build once with `npm run build` first.

**On Linux/Raspberry Pi:** You'll likely need to run with `sudo` for Bluetooth access:
```bash
sudo npm start
```

## Home Assistant Configuration

### Where to Put the YAML Configuration

**Important:** The YAML configuration goes in your Home Assistant `configuration.yaml` file. The location depends on your installation:

- **Home Assistant OS / Supervised**: `/config/configuration.yaml`
- **Docker**: Usually mounted at `/config/configuration.yaml`
- **Linux**: `~/.homeassistant/configuration.yaml` or `/etc/homeassistant/configuration.yaml`
- **macOS**: `~/.homeassistant/configuration.yaml`

You can also access it from Home Assistant UI:
1. Go to **Settings** → **Add-ons** → **File editor** (if installed)
2. Or use **Settings** → **Developer Tools** → **YAML** (for advanced users)

### Option 1: Manual Configuration (YAML)

Add to your `configuration.yaml`:

```yaml
light:
  - platform: mqtt
    name: "Living Room Light"
    unique_id: "ilink_light1"
    state_topic: "ilink/light1/state"
    command_topic: "ilink/light1/set"
    brightness: true
    rgb: true
    color_temp: true
    schema: json
    optimistic: false
    qos: 1
    retain: true
```

**After editing, restart Home Assistant:**
- Go to **Settings** → **System** → **Restart**
- Or use the restart button in the UI

### Option 2: MQTT Integration UI

1. Go to **Settings** → **Devices & Services** → **MQTT**
2. Click **Configure** or **Add Integration**
3. Add a device manually:
   - **Name**: Living Room Light
   - **Type**: Light
   - **State Topic**: `ilink/light1/state`
   - **Command Topic**: `ilink/light1/set`
   - **Brightness**: Enabled
   - **RGB**: Enabled
   - **Color Temperature**: Enabled
   - **Schema**: JSON

## MQTT Topics

### Command Topic (Home Assistant → Bridge)

**Topic**: `ilink/{deviceId}/set`

**Payload** (JSON):
```json
{
  "state": "ON",
  "brightness": 255,
  "color": {
    "r": 255,
    "g": 0,
    "b": 0
  },
  "color_temp": 370
}
```

### State Topic (Bridge → Home Assistant)

**Topic**: `ilink/{deviceId}/state`

**Payload** (JSON):
```json
{
  "state": "ON",
  "brightness": 255,
  "color": {
    "r": 255,
    "g": 0,
    "b": 0
  },
  "color_temp": 370
}
```

## Architecture

```
Home Assistant
    │
    ├─► MQTT Broker
    │       │
    │       ├─► Command Topic: ilink/{deviceId}/set
    │       └─► State Topic: ilink/{deviceId}/state (retained)
    │
    └─► iLink Bridge
            │
            ├─► BLE Manager (connects to devices)
            │
            └─► Device Handler (iLink protocol)
                    │
                    └─► iLink Light (Bluetooth)
```

## Integration with Monorepo

This project is designed to be integrated into the `smart-home` monorepo after the refactor described in `monorepo_architecture_migration.md`. Once integrated:

1. Move this to `packages/ilink-bridge` or similar
2. Share types from `packages/shared`
3. Reuse BLE utilities from `packages/backend`
4. Integrate with the backend's MQTT adapter if needed

## Testing

See [TESTING.md](./TESTING.md) for a complete guide on:
- Verifying the bridge is working
- Testing MQTT communication
- Verifying Home Assistant integration
- Troubleshooting common issues

Quick test commands:

```bash
# Subscribe to see all MQTT messages
mosquitto_sub -h localhost -t 'ilink/#' -v

# Send a test command (in another terminal)
mosquitto_pub -h localhost -t 'ilink/light1/set' -m '{"state":"ON"}'
```

## Troubleshooting

### Device Not Found

- Ensure Bluetooth is enabled and the device is powered on
- Check that the MAC address is correct
- Try scanning for devices manually

### MQTT Connection Failed

- Verify MQTT broker is running: `mosquitto_sub -h localhost -t '#' -v`
- Check broker URL and credentials
- Ensure firewall allows MQTT port (default: 1883)

### Permission Errors (Linux)

On Linux, Bluetooth Low Energy (BLE) operations typically require root privileges. You have two options:

**Option 1: Run with sudo (simplest)**
```bash
sudo npm run scan
sudo npm start
```

**Option 2: Set up capabilities (more secure, but complex)**
```bash
# Add user to bluetooth group
sudo usermod -aG bluetooth $USER

# Set capabilities on node binary (allows BLE without full root)
sudo setcap cap_net_raw+eip $(eval readlink -f $(which node))

# Log out and back in, or use:
newgrp bluetooth

# Then try without sudo
npm run scan
```

**Note:** The `noble` library requires elevated privileges on Linux. Running with `sudo` is the simplest solution for development and testing.

### Device Disconnects Frequently

- Ensure device is within range
- Check for interference from other Bluetooth devices
- Increase reconnection attempts in code if needed

## Development

### Project Structure

```
ilink/
├── src/
│   ├── index.ts          # Main entry point
│   ├── ble-manager.ts    # BLE connection management
│   ├── device.ts         # iLink device handler
│   ├── mqtt-bridge.ts   # MQTT communication
│   ├── encoding.ts       # iLink protocol encoding/decoding
│   └── types.ts          # TypeScript types
├── dist/                 # Compiled JavaScript
├── package.json
├── tsconfig.json
└── README.md
```

### Building

```bash
npm run build
```

### Watching for Changes

```bash
npm run watch
```

## License

MIT
