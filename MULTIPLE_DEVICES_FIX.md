# Multiple BLE Devices Connection Fix

## Problem
Raspberry Pi Bluetooth adapters (especially built-in ones) **cannot scan for BLE devices while connected to another BLE device**. This is a hardware/BlueZ limitation, not a code bug.

### Symptoms
- First device connects successfully ✅
- Second device times out during connection ❌
- Device is found during scan (RSSI is fine)
- Connection stays in "connecting" state for 60 seconds then times out
- Happens regardless of which device is first/second

## Root Cause
When the first device is connected, the Bluetooth adapter is "busy" with that connection. When we try to scan for the second device, the adapter cannot perform the scan operation, causing the connection attempt to hang.

## Solution Implemented
**Temporary Disconnect Strategy:**
1. When connecting to a new device, temporarily disconnect all existing connections
2. Scan for the new device (now possible since nothing is connected)
3. Connect to the new device
4. Reconnect the previously disconnected devices

This works around the hardware limitation by ensuring we never try to scan while connected.

## Changes Made

### 1. Added Device Config Storage
- Store device configs in `BLEManager` so we can reconnect devices later
- Location: `src/ble-manager.ts`

### 2. Temporary Disconnect Before Scanning
- Before scanning for a new device, disconnect all existing connections
- Store device references and configs for reconnection
- Location: `src/ble-manager.ts` - `connectDevice()` method

### 3. Reconnection After New Device Connects
- After successfully connecting to the new device, reconnect previously disconnected devices
- Re-scan to get fresh peripheral references for reconnection
- Location: `src/ble-manager.ts` - `connectDevice()` method

## Testing Steps

1. **Rebuild the project:**
   ```bash
   npm run build  # or yarn build
   ```

2. **Restart the bridge:**
   ```bash
   sudo systemctl restart ilink-bridge
   sudo journalctl -u ilink-bridge -f
   ```

3. **Watch for these log messages:**
   - `[BLE] Temporarily disconnecting X device(s) to allow scanning for...`
   - `[BLE] Temporarily disconnected <device_id>`
   - `[BLE] Successfully connected to <device_name>`
   - `[BLE] Reconnecting X temporarily disconnected device(s)...`
   - `[BLE] Successfully reconnected <device_name>`

## Expected Behavior

### First Device Connection
- Scans and connects normally (no existing connections to disconnect)

### Second Device Connection
- Temporarily disconnects first device
- Scans for second device
- Connects to second device
- Reconnects first device
- Both devices should now be connected ✅

## Performance Impact

- **Slight delay** when connecting second device (disconnect + reconnect adds ~4-6 seconds)
- **Temporary disconnection** of first device during second device connection
- **Both devices connected** after the process completes

This is acceptable because:
- It's a one-time cost during startup
- Both devices end up connected
- No ongoing performance impact

## Alternative Solutions (If This Doesn't Work)

### Option 1: Scan All Devices First
Instead of connecting then scanning, scan ALL devices first, then connect sequentially:
- Pro: No need to disconnect/reconnect
- Con: Requires refactoring connection flow
- Con: Devices might not be in range during initial scan

### Option 2: External USB Bluetooth Adapter
Use an external USB Bluetooth adapter with better Linux support:
- Pro: May support concurrent connections
- Con: Additional hardware cost
- Con: May still have limitations

### Option 3: ESP32 BLE Proxy
Use ESP32 as BLE proxy (as mentioned in action plan):
- Pro: Very reliable, no BlueZ quirks
- Con: Additional hardware and complexity

### Option 4: BlueZ Configuration
Try adjusting BlueZ settings (may not help with this specific issue):
```bash
sudo nano /etc/bluetooth/main.conf
# Add/modify:
[General]
ControllerMode = le
FastConnectable = true
```

## Troubleshooting

### If reconnection fails:
- Check logs for reconnection errors
- Verify device is still in range (RSSI)
- Try increasing delay between reconnections (currently 2 seconds)

### If second device still times out:
- Check if temporary disconnect is happening (look for log messages)
- Verify scan is completing (look for "Found X device(s) during scan")
- Check BlueZ logs: `sudo journalctl -u bluetooth -f`

### If both devices connect but one disconnects:
- May be a range/interference issue
- Check RSSI values in logs
- Consider device placement

## Summary

This fix addresses the Raspberry Pi Bluetooth adapter limitation by temporarily disconnecting existing connections before scanning for new devices. It's a workaround for hardware limitations, but it should allow you to connect to multiple devices successfully.

The key insight: **Raspberry Pi Bluetooth adapters cannot scan while connected to BLE devices** - this is a known limitation, not a bug in your code.
