# Testing Guide

This guide will help you verify that the iLink Home Assistant integration is working correctly.

## Step 1: Verify MQTT Broker is Running

First, make sure your MQTT broker is accessible:

```bash
# Test MQTT broker connection
mosquitto_sub -h localhost -t '#' -v
```

If this works, you should see messages when devices publish state. Press Ctrl+C to stop.

## Step 2: Start the Bridge

```bash
npm run build
npm start
```

You should see output like:
```
[Main] Starting iLink Home Assistant Bridge...
[Main] Loaded 1 device(s)
[MQTT] Connected to broker
[Main] MQTT bridge connected
[BLE] Adapter powered on
[Main] BLE manager initialized
[Main] Connecting to Living Room Light...
[BLE] Looking for device Living Room Light (aa:bb:cc:dd:ee:ff)
[BLE] Found device: Living Room Light (aa:bb:cc:dd:ee:ff)
[Device] Connected to Living Room Light (light1)
[Main] Successfully connected to Living Room Light
[Main] Bridge running. 1 device(s) connected.
```

## Step 3: Verify MQTT Topics

In a new terminal, subscribe to the state topic:

```bash
# Subscribe to all iLink topics
mosquitto_sub -h localhost -t 'ilink/#' -v
```

You should see state updates published periodically (every 30 seconds) and when commands are sent.

Example output:
```
ilink/light1/state {"state":"ON","brightness":255,"color":{"r":255,"g":0,"b":0}}
```

## Step 4: Test Sending Commands

In another terminal, send a test command:

```bash
# Turn on the light
mosquitto_pub -h localhost -t 'ilink/light1/set' -m '{"state":"ON"}'

# Set brightness
mosquitto_pub -h localhost -t 'ilink/light1/set' -m '{"brightness":128}'

# Set color (red)
mosquitto_pub -h localhost -t 'ilink/light1/set' -m '{"color":{"r":255,"g":0,"b":0}}'
```

Watch the bridge logs - you should see:
```
[MQTT] Received command for light1: { state: 'ON' }
[Device] Sent command to Living Room Light: 55aa0108050100...
[MQTT] Published state for light1: { state: 'ON', brightness: 255 }
```

And the light should respond physically!

## Step 5: Verify Home Assistant Integration

### Option A: Using YAML Configuration

1. **Locate your Home Assistant configuration directory:**
   - **HassOS/Home Assistant OS**: `/config/`
   - **Docker**: Usually mounted at `/config/`
   - **Linux**: Usually `~/.homeassistant/` or `/etc/homeassistant/`
   - **macOS**: `~/.homeassistant/`

2. **Edit `configuration.yaml`:**
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

3. **Restart Home Assistant:**
   - Go to **Settings** → **System** → **Restart**

4. **Verify the entity appears:**
   - Go to **Settings** → **Devices & Services**
   - Look for "Living Room Light" under MQTT integration
   - Or check **Developer Tools** → **States** and search for `light.living_room_light`

### Option B: Using MQTT Integration UI

1. Go to **Settings** → **Devices & Services**
2. Click **Add Integration**
3. Search for **MQTT** and select it
4. Configure:
   - **Broker**: `localhost` (or your MQTT broker IP)
   - **Port**: `1883` (default)
   - **Username/Password**: If configured
5. After adding MQTT, click **Configure** on the MQTT integration
6. Click **Add Device** → **Add Light**
7. Fill in:
   - **Name**: Living Room Light
   - **State Topic**: `ilink/light1/state`
   - **Command Topic**: `ilink/light1/set`
   - Enable: Brightness, RGB, Color Temperature
   - **Schema**: JSON
   - **Optimistic**: Off
   - **QoS**: 1
   - **Retain**: On

## Step 6: Test from Home Assistant

1. Go to **Overview** (or create a new dashboard)
2. Find your light entity
3. Click on it to open the light control
4. Try:
   - Toggle power on/off
   - Adjust brightness slider
   - Change color using the color picker
   - Change color temperature

Watch the bridge logs to confirm commands are received and processed.

## Troubleshooting

### No MQTT messages appearing

- Check MQTT broker is running: `mosquitto_sub -h localhost -t '#' -v`
- Verify broker URL in `.env` matches your setup
- Check firewall settings if broker is on different machine

### Device not connecting

- Verify MAC address is correct (use `npm run scan`)
- Ensure device is powered on and in range
- Check Bluetooth permissions (Linux: `sudo usermod -aG bluetooth $USER`)

### Home Assistant entity not appearing

- Check Home Assistant logs: **Settings** → **System** → **Logs**
- Verify YAML syntax is correct (use YAML validator)
- Ensure MQTT integration is properly configured
- Check that topics match exactly (case-sensitive)

### Commands not working

- Verify device is connected (check bridge logs)
- Check MQTT topics match exactly
- Ensure JSON payload format is correct
- Check bridge logs for error messages

## Debug Mode

To see more detailed logs, you can modify the code or add:

```bash
DEBUG=* npm start
```

Or add console.log statements in the code for more verbose output.
