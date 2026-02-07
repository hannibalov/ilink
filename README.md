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
# IMPORTANT: The DEVICES array MUST be on a single line in the .env file!
DEVICES=[{"id":"living_room","name":"Living Room Light","macAddress":"aa:bb:cc:dd:ee:ff","targetChar":"a040","statusChar":"a042"}]
```

**Important Notes:**
- **The `DEVICES` array MUST be on a single line in the `.env` file!** Environment variables don't support multi-line values, so the entire JSON array must be on one line.
- Each device must have a **unique `id`**. This `id` is used to create MQTT topics:
  - Command topic: `ilink/{id}/set`
  - State topic: `ilink/{id}/state`

**Example with multiple devices (single line):**
```env
DEVICES=[{"id":"living_room","name":"Living Room Light","macAddress":"aa:bb:cc:dd:ee:ff","targetChar":"a040","statusChar":"a042"},{"id":"bedroom","name":"Bedroom Light","macAddress":"11:22:33:44:55:66","targetChar":"a040","statusChar":"a042"}]
```

### Finding Device Addresses/IDs

**On Linux/Raspberry Pi:**
```bash
# Use the built-in scan script (requires sudo for BLE access)
sudo yarn scan
# or
sudo npm run scan

# Press Ctrl+C when done scanning
# The script will output device information including MAC addresses
```

**On macOS:**
macOS doesn't expose BLE MAC addresses due to privacy. You need to use device IDs instead:

```bash
# Run the scan script
yarn scan

# Look for devices named "ilink app" or similar
# Copy the device ID (32-character hex string) shown in the output
# Example: 816317bee3a2b892566ab3c7b4d95ec7
```

Then use the device ID as the `macAddress` value in your `.env` file:

```env
# IMPORTANT: DEVICES array must be on a single line!
DEVICES=[{"id":"living_room","name":"Living Room Light","macAddress":"816317bee3a2b892566ab3c7b4d95ec7","targetChar":"a040","statusChar":"a042"}]
```

**Note:** On macOS, the `macAddress` field accepts either:
- Traditional MAC address format: `aa:bb:cc:dd:ee:ff` (Linux)
- Device ID format: `816317bee3a2b892566ab3c7b4d95ec7` (macOS)

### Device Configuration Fields

- `id`: **Unique identifier for the device** (used in MQTT topics) - **Must be unique for each device!**
  - Examples: `"living_room"`, `"bedroom"`, `"kitchen_light"`
  - Used in MQTT topics: `ilink/{id}/set` and `ilink/{id}/state`
- `name`: Friendly name (for logging and display)
- `macAddress`: Bluetooth MAC address (Linux) or device ID (macOS)
- `targetChar`: Characteristic UUID for writing commands (default: `a040`)
- `statusChar`: Characteristic UUID for reading status (default: `a042`)

## Running

### Development Mode

Runs TypeScript directly without building (good for development):

```bash
npm run dev
# or
yarn dev
```

**On Linux/Raspberry Pi:** You'll likely need to run with `sudo` for Bluetooth access:
```bash
sudo yarn dev
```

### Production Mode

Builds and runs the compiled JavaScript:

```bash
npm start
# or
yarn start
```

**On Linux/Raspberry Pi:** You'll likely need to run with `sudo` for Bluetooth access:
```bash
sudo yarn start
```

## Running as a Service on Raspberry Pi

To run the bridge automatically on boot and keep it running:

### Step 1: Build the Project

```bash
cd /path/to/ilink
yarn build
```

### Step 2: Set Up the Systemd Service

Use the provided setup script:

```bash
sudo ./scripts/setup-service.sh
```

This script will:
- Create a systemd service file at `/etc/systemd/system/ilink-bridge.service`
- Configure it to run on boot
- Set up proper logging and restart behavior

### Step 3: Start the Service

```bash
# Start the service
sudo systemctl start ilink-bridge

# Check status
sudo systemctl status ilink-bridge

# View logs
sudo journalctl -u ilink-bridge -f
```

### Step 4: Enable on Boot

The setup script automatically enables the service, but you can verify:

```bash
# Enable service to start on boot
sudo systemctl enable ilink-bridge

# Verify it's enabled
sudo systemctl is-enabled ilink-bridge
```

### Service Management Commands

```bash
# Start service
sudo systemctl start ilink-bridge

# Stop service
sudo systemctl stop ilink-bridge

# Restart service
sudo systemctl restart ilink-bridge

# Check status
sudo systemctl status ilink-bridge

# View logs (follow)
sudo journalctl -u ilink-bridge -f

# View recent logs
sudo journalctl -u ilink-bridge -n 100

# Disable auto-start on boot
sudo systemctl disable ilink-bridge
```

### Troubleshooting the Service

If the service fails to start:

1. **Check service status:**
   ```bash
   sudo systemctl status ilink-bridge
   ```

2. **Check logs:**
   ```bash
   sudo journalctl -u ilink-bridge -n 50
   ```

3. **Verify the build:**
   ```bash
   ls -la dist/index.js
   ```

4. **Test manually:**
   ```bash
   cd /path/to/ilink
   sudo node dist/index.js
   ```

5. **Check Bluetooth permissions:**
   - The service runs as your user, but BLE on Linux typically requires root
   - The setup script may need adjustment if you encounter permission errors
   - Consider running with `sudo` or setting up capabilities (see Permission Errors section)

## Home Assistant Configuration

### Option 1: YAML Configuration (Recommended)

Add to your Home Assistant `configuration.yaml`:

```yaml
mqtt:
  - light:
      name: "Living Room Light"
      unique_id: "ilink_living_room"
      state_topic: "ilink/living_room/state"
      command_topic: "ilink/living_room/set"
      schema: json
      brightness: true
      rgb: true
      color_temp: true
      optimistic: false
      qos: 1
      retain: true

  - light:
      name: "Bedroom Light"
      unique_id: "ilink_bedroom"
      state_topic: "ilink/bedroom/state"
      command_topic: "ilink/bedroom/set"
      schema: json
      brightness: true
      rgb: true
      color_temp: true
      optimistic: false
      qos: 1
      retain: true
```

**Important:** 
- Replace `living_room` and `bedroom` with your actual device IDs from `.env`
- The `id` in `.env` must match the topic names: `ilink/{id}/state` and `ilink/{id}/set`
- Each device needs a unique `unique_id`

**After editing, restart Home Assistant:**
- Go to **Settings** → **System** → **Restart**

### Option 2: MQTT Integration UI

1. Go to **Settings** → **Devices & Services** → **MQTT**
2. Click **Configure** or **Add Integration**
3. Add a device manually:
   - **Name**: Living Room Light
   - **Type**: Light
   - **State Topic**: `ilink/living_room/state`
   - **Command Topic**: `ilink/living_room/set`
   - **Brightness**: Enabled
   - **RGB**: Enabled
   - **Color Temperature**: Enabled
   - **Schema**: JSON
   - **Optimistic**: Off
   - **QoS**: 1
   - **Retain**: On

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

## Testing

### Test MQTT Communication

```bash
# Subscribe to see all MQTT messages
mosquitto_sub -h localhost -t 'ilink/#' -v

# Send a test command (in another terminal)
mosquitto_pub -h localhost -t 'ilink/living_room/set' -m '{"state":"ON"}'
```

### Verify Bridge is Running

You should see output like:
```
[Main] Starting iLink Home Assistant Bridge...
[Main] Loaded 2 device(s)
[MQTT] Connected to broker at mqtt://localhost:1883
[BLE] Adapter powered on
[Main] Connecting to Living Room Light...
[Device] Successfully connected to Living Room Light (living_room)
[Main] Bridge running. 2 device(s) connected.
```

## Troubleshooting

### Device Not Found

**On Linux:**
- Ensure Bluetooth is enabled and the device is powered on
- Check that the MAC address is correct (use `sudo yarn scan`)
- Try scanning for devices manually

**On macOS:**
- Use device IDs instead of MAC addresses (see Finding Device Addresses/IDs section)
- Run `yarn scan` to find device IDs
- Make sure devices are powered on and in range

### MQTT Connection Failed

- Verify MQTT broker is running: `mosquitto_sub -h localhost -t '#' -v`
- Check broker URL and credentials in `.env`
- Ensure firewall allows MQTT port (default: 1883)
- If broker is on a different machine, use the IP address: `mqtt://192.168.x.x:1883`

### Permission Errors (Linux)

On Linux, Bluetooth Low Energy (BLE) operations typically require root privileges. You have two options:

**Option 1: Run with sudo (simplest)**
```bash
sudo yarn scan
sudo yarn start
```

**Option 2: Set up capabilities (more secure)**
```bash
# Add user to bluetooth group
sudo usermod -aG bluetooth $USER

# Set capabilities on node binary (allows BLE without full root)
sudo setcap cap_net_raw+eip $(eval readlink -f $(which node))

# Log out and back in, or use:
newgrp bluetooth

# Then try without sudo
yarn scan
```

**Note:** The `noble` library requires elevated privileges on Linux. Running with `sudo` is the simplest solution.

### Device Disconnects Frequently

- Ensure device is within range
- Check for interference from other Bluetooth devices
- Verify the device is powered on
- Check bridge logs for error messages

### Home Assistant Entity Not Appearing

1. **Check Home Assistant logs:**
   - Go to **Settings** → **System** → **Logs**
   - Look for errors related to MQTT or lights

2. **Verify MQTT integration:**
   - Go to **Settings** → **Devices & Services** → **MQTT**
   - Ensure MQTT is configured and connected

3. **Check topics match:**
   - Device ID in `.env` must match topic names in Home Assistant config
   - Topics are case-sensitive

4. **Test MQTT directly:**
   ```bash
   # Subscribe to see if state is being published
   mosquitto_sub -h localhost -t 'ilink/#' -v
   
   # Should see state updates every 30 seconds
   ```

### Service Won't Start on Raspberry Pi

1. **Check service logs:**
   ```bash
   sudo journalctl -u ilink-bridge -n 50
   ```

2. **Verify build exists:**
   ```bash
   ls -la dist/index.js
   ```

3. **Test manually:**
   ```bash
   cd /path/to/ilink
   sudo node dist/index.js
   ```

4. **Check Bluetooth permissions:**
   - Service may need to run as root or with capabilities
   - See Permission Errors section above

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
├── scripts/
│   └── setup-service.sh  # Systemd service setup script
├── package.json
├── tsconfig.json
└── README.md
```

### Building

```bash
npm run build
# or
yarn build
```

### Watching for Changes

```bash
npm run watch
# or
yarn watch
```

### Running Tests

```bash
npm test
# or
yarn test
```

## License

MIT

# Author 

Rodrigo Pizarro @hannibalov