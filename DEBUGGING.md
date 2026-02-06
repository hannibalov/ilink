# Debugging Guide

## Issue: Can't see MQTT messages with mosquitto_sub

If you can't see messages when running `mosquitto_sub -h localhost -t '#' -v` but commands from Home Assistant work, here are the most common causes:

### 1. MQTT Broker is on a Different Machine

**Problem:** If Home Assistant is running on a different machine than your Raspberry Pi, the MQTT broker might be on that machine, not on localhost.

**Solution:**

1. **Find where your MQTT broker is running:**
   - Check your `.env` file for `MQTT_BROKER_URL`
   - If it's `mqtt://localhost:1883`, the broker should be on the Pi
   - If it's `mqtt://192.168.x.x:1883` or similar, the broker is on another machine

2. **If broker is on Home Assistant machine:**
   ```bash
   # On Raspberry Pi, subscribe to the remote broker
   mosquitto_sub -h <HOME_ASSISTANT_IP> -t 'ilink/#' -v
   ```

3. **If broker is on Raspberry Pi but Home Assistant connects remotely:**
   - Make sure Mosquitto is configured to accept remote connections
   - Check `/etc/mosquitto/mosquitto.conf`:
     ```conf
     listener 1883
     allow_anonymous true
     # Or configure authentication
     ```
   - Restart Mosquitto: `sudo systemctl restart mosquitto`

### 2. Check Bridge Logs

Look for these log messages when you send a command from Home Assistant:

```
[MQTT] Received command for light1: { state: 'ON' }
[Device] Sent command to Living Room Light: 55aa0108050100...
[MQTT] Publishing state for light1 to topic ilink/light1/state: { state: 'ON', brightness: 255 }
[MQTT] Successfully published state for light1
```

If you see "Cannot publish state" warnings, the MQTT client isn't connected.

### 3. Verify MQTT Connection

Add this test to verify the bridge can publish:

```bash
# In one terminal, subscribe to see all messages
mosquitto_sub -h localhost -t 'ilink/#' -v

# In another terminal, check if the bridge is connected
# Look at bridge logs - you should see:
# [MQTT] Connected to broker at mqtt://localhost:1883
```

### 4. Test Publishing Manually

Test if you can publish to the broker:

```bash
# Terminal 1: Subscribe
mosquitto_sub -h localhost -t 'ilink/test' -v

# Terminal 2: Publish
mosquitto_pub -h localhost -t 'ilink/test' -m '{"test": "message"}'
```

If this doesn't work, Mosquitto isn't running or isn't accessible.

### 5. Check MQTT Broker Status

```bash
# Check if Mosquitto is running
sudo systemctl status mosquitto

# Check if port 1883 is listening
sudo netstat -tlnp | grep 1883
# or
sudo ss -tlnp | grep 1883

# Check Mosquitto logs
sudo journalctl -u mosquitto -f
```

### 6. Verify Topics Match

Make sure the topics in your Home Assistant configuration match what the bridge uses:

- Bridge publishes to: `ilink/{deviceId}/state`
- Bridge subscribes to: `ilink/{deviceId}/set`
- Your device ID in `.env` must match what's in Home Assistant config

### 7. Enable Debug Logging

To see more detailed MQTT logs, you can temporarily add more logging:

```typescript
// In mqtt-bridge.ts, add after client creation:
this.client.on('packetsend', (packet) => {
  console.log('[MQTT] Sending packet:', packet);
});

this.client.on('packetreceive', (packet) => {
  console.log('[MQTT] Received packet:', packet);
});
```

### 8. Common Issues Checklist

- [ ] MQTT broker is running (`sudo systemctl status mosquitto`)
- [ ] Bridge logs show "Connected to broker"
- [ ] Bridge logs show "Published state" messages (not warnings)
- [ ] Topics match between bridge and Home Assistant
- [ ] Using correct broker URL (localhost vs remote IP)
- [ ] Mosquitto allows connections (check `mosquitto.conf`)
- [ ] Firewall allows port 1883

### 9. Quick Test Script

Create a test script to verify everything:

```bash
#!/bin/bash
echo "Testing MQTT setup..."

echo "1. Checking Mosquitto status..."
sudo systemctl status mosquitto --no-pager | head -5

echo "2. Testing local publish/subscribe..."
timeout 2 mosquitto_sub -h localhost -t 'test' -v &
sleep 1
mosquitto_pub -h localhost -t 'test' -m 'test message'
sleep 1

echo "3. Checking bridge topics..."
timeout 5 mosquitto_sub -h localhost -t 'ilink/#' -v &
sleep 2
mosquitto_pub -h localhost -t 'ilink/test/set' -m '{"state":"ON"}'
sleep 2
```

Save as `test-mqtt.sh`, make executable (`chmod +x test-mqtt.sh`), and run it.
