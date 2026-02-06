# Troubleshooting: Lights Not Appearing in Home Assistant

## Step 1: Verify Home Assistant Restarted

1. **Check Home Assistant logs:**
   ```bash
   # If using Docker
   docker logs homeassistant --tail 50
   
   # Or check the UI: Settings → System → Logs
   ```

2. **Look for errors** related to:
   - MQTT configuration
   - YAML syntax errors
   - Light entity creation

## Step 2: Check MQTT Integration is Configured

1. **Go to:** Settings → Devices & Services → MQTT
2. **Verify:**
   - MQTT integration is configured
   - Status shows "Connected"
   - If not configured, add it:
     - Click "Configure" or "Add Integration"
     - Enter broker: `localhost` (or your broker IP)
     - Port: `1883`
     - Add username/password if needed

## Step 3: Verify Bridge is Running

```bash
# Check if bridge process is running
ps aux | grep "node.*dist/index.js" | grep -v grep

# Or check systemd service
sudo systemctl status ilink-bridge

# Check bridge logs
sudo journalctl -u ilink-bridge -n 50
```

**You should see:**
```
[MQTT] Connected to broker
[MQTT] Subscribed to ilink/+/set
[Device] Connected to ...
```

## Step 4: Check MQTT Topics are Active

**Subscribe to see MQTT messages:**
```bash
mosquitto_sub -h localhost -t 'ilink/#' -v
```

**You should see:**
- State updates every 30 seconds: `ilink/living_room/state {"state":"ON",...}`
- If you don't see anything, the bridge isn't publishing

## Step 5: Check Entities Were Created

1. **Go to:** Settings → Developer Tools → States
2. **Search for:**
   - `light.living_room_light`
   - `light.bedroom_light`
   - Or search for `ilink`

3. **If entities exist but are "unavailable":**
   - Check MQTT connection
   - Check bridge is running
   - Check topics match

## Step 6: Verify Configuration Matches

**Check your .env file device IDs:**
```bash
cat ~/Documents/ilink/.env | grep DEVICES
```

**Check your configuration.yaml topics match:**
```bash
cat ~/homeassistant/config/configuration.yaml | grep -A 10 mqtt
```

**The device ID in .env must match the topic name:**
- `.env`: `"id": "living_room"` → Topics: `ilink/living_room/state` and `ilink/living_room/set`
- `.env`: `"id": "bedroom"` → Topics: `ilink/bedroom/state` and `ilink/bedroom/set`

## Step 7: Test MQTT Communication

**Send a test command:**
```bash
mosquitto_pub -h localhost -t 'ilink/living_room/set' -m '{"state":"ON"}'
```

**Check bridge logs** - you should see:
```
[MQTT] Received command for living_room: { state: 'ON' }
[Device] Sent command to Living Room Light: ...
```

**Check if state is published:**
```bash
mosquitto_sub -h localhost -t 'ilink/living_room/state' -v
# Should see: ilink/living_room/state {"state":"ON",...}
```

## Step 8: Check Home Assistant Entity Registry

1. **Go to:** Settings → Devices & Services → Entities
2. **Filter by:** MQTT
3. **Look for** your light entities
4. **If they exist but are disabled:**
   - Click on the entity
   - Enable it

## Step 9: Force Entity Discovery

Sometimes entities need to be manually added:

1. **Go to:** Settings → Devices & Services → MQTT → Configure
2. **Click:** "Add Device" or the "+" button
3. **Select:** "Add Light"
4. **Fill in:**
   - Name: Living Room Light
   - State Topic: `ilink/living_room/state`
   - Command Topic: `ilink/living_room/set`
   - Schema: JSON
   - Enable: Brightness, RGB
   - Optimistic: Off
   - QoS: 1
   - Retain: On

## Step 10: Check YAML Configuration Syntax

**Validate your YAML:**
```bash
# Check for syntax errors
python3 -c "import yaml; yaml.safe_load(open('~/homeassistant/config/configuration.yaml'))"
```

**Common YAML errors:**
- Missing indentation
- Wrong number of spaces (must be consistent)
- Missing colons
- List items not properly formatted

## Quick Checklist

- [ ] Home Assistant restarted after config change
- [ ] MQTT integration is configured and connected
- [ ] Bridge is running (`sudo systemctl status ilink-bridge`)
- [ ] Bridge logs show devices connected
- [ ] MQTT topics are active (test with `mosquitto_sub`)
- [ ] Device IDs in .env match topic names in configuration.yaml
- [ ] YAML syntax is correct
- [ ] Entities appear in Developer Tools → States (even if unavailable)

## Still Not Working?

**Enable debug logging in Home Assistant:**

Add to `configuration.yaml`:
```yaml
logger:
  default: info
  logs:
    homeassistant.components.mqtt: debug
    homeassistant.components.light.mqtt: debug
```

Then restart and check logs for MQTT-related messages.
