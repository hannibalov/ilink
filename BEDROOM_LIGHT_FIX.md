# Bedroom Light Connection Timeout Fix

## Problem
The bedroom light is timing out during connection (15 seconds), while the living room light connects successfully (takes ~42 seconds).

## Root Cause
The connection timeout of 15 seconds is too short for Raspberry Pi BLE connections, especially when:
- The Bluetooth stack is busy from a previous connection
- The device is further away (weaker signal)
- The device needs more time to respond

## Changes Made

### 1. Increased Connection Timeout
- Changed from 15 seconds to **60 seconds**
- Location: `src/device.ts` line 67
- This gives devices more time to establish connection

### 2. Increased Delay Between Connections
- Changed from 2 seconds to **5 seconds** between device connections
- Location: `src/index.ts` line 89
- Gives the Bluetooth stack more time to stabilize after the first connection

### 3. Added Diagnostic Logging
- Added logging to show:
  - How many devices found during scan
  - RSSI (signal strength) for each device
  - Whether device was found during scan
- Location: `src/ble-manager.ts`

## Testing Steps

1. **Rebuild and restart:**
   ```bash
   npm run build  # or yarn build
   sudo systemctl restart ilink-bridge
   sudo journalctl -u ilink-bridge -f
   ```

2. **Watch for these log messages:**
   - `[BLE] Scanning for Bedroom Light...`
   - `[BLE] Found X device(s) during scan`
   - `[BLE] Found Bedroom Light: <address> (RSSI: <value>)`
   - Connection should now have 60 seconds instead of 15

3. **If bedroom light still times out, check:**

   **a) Is the device found during scan?**
   - Look for: `[BLE] Found Bedroom Light: ...`
   - If NOT found: Device might be out of range, powered off, or MAC address is wrong

   **b) What's the RSSI (signal strength)?**
   - Good: -50 to -70 dBm
   - Weak: -80 to -90 dBm (might cause connection issues)
   - Very weak: < -90 dBm (likely won't connect)

   **c) Check BlueZ logs for errors:**
   ```bash
   sudo journalctl -u bluetooth -f
   ```

   **d) Try connecting to bedroom light FIRST:**
   - Swap the order in your config
   - If bedroom connects first but living room doesn't, it's a Bluetooth stack busy issue

## Additional Troubleshooting

### If device is not found during scan:
1. **Check if device is powered on and in range**
2. **Verify MAC address is correct:**
   ```bash
   sudo yarn scan
   # Look for the bedroom light and verify MAC address
   ```
3. **Check signal strength:**
   ```bash
   sudo hcitool rssi <MAC_ADDRESS>
   ```

### If device is found but still times out:
1. **Try increasing delay even more** (change 5000ms to 10000ms in `src/index.ts`)
2. **Check for interference** - other Bluetooth devices, WiFi, etc.
3. **Try connecting to bedroom light first** (swap order in config)
4. **Check BlueZ configuration** (see NEXT_STEPS.md Option A)

### If both devices work but bedroom is unreliable:
1. **Check RSSI** - bedroom might be further away
2. **Consider Bluetooth adapter placement** - move Raspberry Pi closer
3. **Check for physical obstructions** between Pi and bedroom light

## Expected Behavior After Fix

- Bedroom light should connect within 60 seconds
- You should see RSSI values in logs
- Connection should be more reliable

## If Still Not Working

1. **Capture Bluetooth packet trace:**
   ```bash
   sudo btmon > /tmp/btmon.log
   # In another terminal, restart the bridge
   # Then check /tmp/btmon.log for connection attempts
   ```

2. **Try connecting to bedroom light FIRST** (swap order in config)

3. **Check if it's a specific device issue:**
   - Does bedroom light work on macOS?
   - Try swapping the MAC addresses in config (use bedroom MAC for living room, living room MAC for bedroom)
   - If the "bedroom" MAC works in living room position, it's a location/range issue

4. **Consider hardware:**
   - External USB Bluetooth adapter (better range/performance)
   - Move Raspberry Pi closer to bedroom light
