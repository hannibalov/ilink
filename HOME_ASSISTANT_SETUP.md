# Home Assistant Integration - Step by Step Guide

This guide will help you add your iLink lights to Home Assistant using YAML configuration files.

## Prerequisites

- Home Assistant is running on your Raspberry Pi
- The iLink bridge is running (`sudo npm start`)
- You have configured your devices in `.env` with unique IDs

## Step 1: Find Your Home Assistant Configuration Directory

The location depends on how Home Assistant is installed:

### Option A: Home Assistant OS (HassOS)
```bash
# Configuration is at:
/config/configuration.yaml
```

### Option B: Home Assistant Supervised
```bash
# Usually at:
/usr/share/hassio/homeassistant/configuration.yaml
# Or accessible via:
cd /config
```

### Option C: Docker Installation
```bash
# Find your Home Assistant container
docker ps | grep homeassistant

# Access the config directory (usually mounted volume)
# Check docker-compose.yml or docker run command for volume mount
# Common locations:
# - ~/homeassistant/config/configuration.yaml
# - /home/homeassistant/.homeassistant/configuration.yaml
```

### Option D: Python Virtual Environment
```bash
# Usually at:
~/.homeassistant/configuration.yaml
# or
/home/homeassistant/.homeassistant/configuration.yaml
```

**Quick way to find it:**
```bash
# Search for configuration.yaml
find / -name "configuration.yaml" 2>/dev/null | grep -v proc
```

## Step 2: Check Your Device IDs

Look at your `.env` file to see what device IDs you configured:

```bash
cat ~/Documents/ilink/.env | grep DEVICES
```

For example, if you have:
- `"id": "living_room"`
- `"id": "bedroom"`

Then your MQTT topics will be:
- `ilink/living_room/state` and `ilink/living_room/set`
- `ilink/bedroom/state` and `ilink/bedroom/set`

## Step 3: Edit configuration.yaml

1. **Open the configuration file:**
   ```bash
   sudo nano /config/configuration.yaml
   # or wherever your config file is located
   ```

2. **Add the MQTT light configuration:**

   Add this section to your `configuration.yaml` file. **Note:** This uses the NEW MQTT configuration format (not `platform: mqtt` under `light:`):

   ```yaml
   mqtt:
     # First iLink device - replace "living_room" with your device ID
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

     # Second iLink device - replace "bedroom" with your device ID
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

3. **Important:** 
   - Replace `living_room` and `bedroom` with your actual device IDs from `.env`
   - Make sure the topic names match exactly: `ilink/{your_device_id}/state` and `ilink/{your_device_id}/set`
   - Each device needs a unique `unique_id`

## Step 4: Verify YAML Syntax

Before restarting, check if your YAML is valid:

```bash
# If you have the Home Assistant CLI installed
hass --script check_config

# Or use an online YAML validator
# Or just restart and check the logs
```

## Step 5: Restart Home Assistant

**Option A: Via UI**
1. Go to **Settings** → **System**
2. Click **Restart** (or the restart button in the top right)

**Option B: Via Command Line**
```bash
# If using systemd
sudo systemctl restart home-assistant@homeassistant.service
# or
sudo systemctl restart homeassistant

# If using Docker
docker restart homeassistant

# If using Home Assistant OS/Supervised
# Use the UI method above
```

## Step 6: Verify the Integration

1. **Check Home Assistant Logs:**
   ```bash
   # Find log location (varies by installation)
   tail -f /config/home-assistant.log
   # or
   journalctl -u home-assistant -f
   ```

2. **Check for Errors:**
   - Go to **Settings** → **System** → **Logs**
   - Look for any errors related to MQTT or lights

3. **Verify Entities Were Created:**
   - Go to **Settings** → **Devices & Services**
   - Look for your lights under **MQTT** integration
   - Or go to **Developer Tools** → **States**
   - Search for `light.living_room_light` and `light.bedroom_light` (or your names)

4. **Test the Lights:**
   - Go to **Overview** (or create a new dashboard)
   - Find your light entities
   - Click on them to open the light control
   - Try turning them on/off, changing brightness, and colors

## Step 7: Troubleshooting

### Lights Don't Appear

1. **Check MQTT Integration:**
   - Go to **Settings** → **Devices & Services** → **MQTT**
   - Make sure MQTT is configured and connected
   - If not configured, add it first

2. **Check Bridge Logs:**
   ```bash
   # In the terminal where bridge is running, you should see:
   [MQTT] Connected to broker
   [MQTT] Subscribed to ilink/+/set
   [Device] Connected to ...
   ```

3. **Check MQTT Topics:**
   ```bash
   # Subscribe to see if messages are being published
   mosquitto_sub -h localhost -t 'ilink/#' -v
   
   # You should see state updates when bridge is running
   ```

4. **Verify Device IDs Match:**
   - Check `.env` file device IDs
   - Check `configuration.yaml` topic names
   - They must match exactly!

### Lights Appear But Don't Respond

1. **Check Bridge is Running:**
   ```bash
   ps aux | grep "node dist/index.js"
   ```

2. **Check Bridge Logs:**
   - When you send a command from Home Assistant, you should see:
   ```
   [MQTT] Received command for living_room: { state: 'ON' }
   [Device] Sent command to Living Room Light: 55aa...
   ```

3. **Test MQTT Directly:**
   ```bash
   # Send a test command
   mosquitto_pub -h localhost -t 'ilink/living_room/set' -m '{"state":"ON"}'
   
   # Check bridge logs to see if it received it
   ```

## Example: Complete configuration.yaml

Here's what a minimal `configuration.yaml` might look like with iLink lights:

```yaml
# Home Assistant Configuration

# MQTT Integration and Lights (NEW format)
mqtt:
  # First light
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

  # Second light
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

**Note:** If you need to configure the MQTT broker connection, add it separately:
```yaml
mqtt:
  broker: localhost
  port: 1883
  # Then add lights as shown above
```

## Next Steps

Once your lights are working:
- Add them to your dashboard
- Create automations
- Group them if needed
- Set up scenes

## Need Help?

If something doesn't work:
1. Check Home Assistant logs
2. Check bridge logs (`sudo npm start` output)
3. Verify MQTT topics match between bridge and Home Assistant
4. Test MQTT communication directly with `mosquitto_sub` and `mosquitto_pub`
