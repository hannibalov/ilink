# Raspberry Pi BLE Connection Troubleshooting

## Problem Summary

The iLink Home Assistant Bridge connects successfully to Bluetooth Low Energy (BLE) lights on macOS, but fails on Raspberry Pi with connection and service discovery issues.

### Initial Symptoms

1. **Service Discovery Timeout**
   - Service discovery times out after 20 seconds
   - Error: `Service discovery timeout after 20 seconds`
   - Followed by: `Peripheral disconnected - need fresh reference`

2. **Immediate Disconnection (Error 62)**
   - Connection establishes successfully (~40 seconds)
   - Device disconnects within 1 second after connection
   - Error code 62: "Connection Failed to be Established"
   - Error message: `Peripheral disconnected during service discovery (periodic check)`

### Error Code 62 Explanation

Error 62 (0x3E) means "The Connection Failed to be Established" - the central device (Raspberry Pi) attempted to send packets to the peripheral (light), but the peripheral never responded. This typically occurs when:
- The device doesn't receive GATT requests quickly enough after connection
- The device times out waiting for communication
- The connection is established but no activity occurs

## Solutions Attempted

### 1. Increased Timeouts and Retries
**Changes:**
- Increased service discovery timeout from 20s to 30s
- Increased retry attempts from 3 to 5
- Added exponential backoff for retries

**Result:** Still timing out, device disconnects before discovery completes

### 2. Connection Stabilization Delays
**Changes:**
- Added 1-second stabilization delay after connection
- Added multiple stability checks (3 checks, 500ms apart)
- Added 500ms delay before starting service discovery

**Result:** Made the problem worse - device disconnected with error 62 because it wasn't receiving GATT requests quickly enough

### 3. Immediate Service Discovery
**Changes:**
- Removed all stabilization delays
- Start service discovery immediately after connection
- Removed delays before discovery

**Result:** Still disconnecting, but confirmed that delays were causing the timeout

### 4. Selective Service Discovery
**Changes:**
- Discover only specific service UUID (`a032`) instead of all services
- Faster discovery process
- Keeps communication active immediately

**Result:** Still disconnecting within 1 second

### 5. Retry Logic with Fresh Peripheral References
**Changes:**
- Added retry mechanism in BLE manager (up to 3 attempts)
- Re-scan to get fresh peripheral reference on failure
- Proper cleanup between retries

**Result:** Helps with recovery but doesn't solve root cause

### 6. Removed Periodic Connection Checks
**Changes:**
- Removed 1-second periodic connection checks during discovery
- Rely only on callbacks and timeouts
- Simplified discovery flow

**Result:** Still disconnecting, but cleaner error handling

### 7. Shortened Timeouts for Fast Retry
**Changes:**
- Reduced service discovery timeout to 3 seconds
- Reduced characteristic discovery timeout to 3 seconds
- Fail fast and retry quickly

**Result:** Faster failure detection, but still disconnecting

## Current Code State

The current implementation:
- Connects to peripheral
- Starts service discovery immediately (no delays)
- Discovers only the specific iLink service UUID (`a032`)
- Uses 3-second timeouts for fast failure and retry
- Has retry logic with fresh peripheral references

## Root Cause Analysis

The device appears to disconnect immediately after connection because:
1. **Timing Issue**: The device expects GATT activity immediately after connection, but service discovery takes time to initiate
2. **Linux BLE Stack**: BlueZ (Linux Bluetooth stack) may have different timing characteristics than macOS's Core Bluetooth
3. **Device-Specific Behavior**: The iLink lights may have a very short timeout window for GATT requests

## Future Potential Solutions

### 1. Immediate GATT Activity After Connection
**Approach:** Write a dummy/keepalive command immediately after connection, before service discovery
- Connect to peripheral
- Immediately write to characteristic UUID (if possible without discovery)
- Then perform service discovery
- This keeps the connection alive while discovery happens

**Implementation Notes:**
- May require constructing characteristic object directly with known UUIDs
- Or use a two-phase approach: quick discovery → immediate write → full discovery

### 2. Bluetooth Adapter Configuration
**Approach:** Tune BlueZ and Bluetooth adapter settings
- Disable Bluetooth power management: `sudo hciconfig hci0 noscan` or configure power management
- Increase connection timeout in BlueZ configuration
- Check for multiple HCI devices and disable unused ones
- Verify Bluetooth adapter is not entering power-saving mode

**Commands to try:**
```bash
# Check Bluetooth adapter power state
sudo hciconfig hci0

# Disable power management
sudo hciconfig hci0 noleadv

# Check BlueZ version and configuration
bluetoothctl --version
sudo systemctl status bluetooth
```

### 3. Connection Parameters
**Approach:** Adjust BLE connection parameters
- Modify connection interval (faster = more frequent communication)
- Adjust supervision timeout
- Change connection latency

**Note:** This may require BlueZ configuration or using different BLE library features

### 4. Alternative Discovery Strategy
**Approach:** Use advertisement data instead of full discovery
- Check if service UUID (`a032`) is advertised in scan data
- Use cached characteristic handles if available
- Skip discovery if we already know the UUIDs

### 5. Library Alternatives
**Approach:** Try different BLE libraries
- `bleno` (different API, may have better Linux support)
- `node-ble` (newer library with better Linux support)
- Direct BlueZ D-Bus API via `dbus-native`

### 6. Device-Specific Sequence
**Approach:** Research if iLink devices require specific connection sequence
- Check iLink device documentation
- Analyze successful connections on macOS to identify sequence differences
- May require specific commands or handshake before discovery

### 7. Connection Pooling/Pre-connection
**Approach:** Maintain persistent connection
- Keep connection alive with periodic writes
- Reuse existing connections instead of reconnecting
- Implement connection pooling

### 8. BlueZ Configuration Tweaks
**Approach:** Modify `/etc/bluetooth/main.conf`
```ini
[General]
# Increase connection timeout
ConnectionTimeout=60

# Disable auto-connect
AutoConnect=false

# Adjust connection parameters
[LE]
# Connection interval (units of 1.25ms)
MinConnectionInterval=6
MaxConnectionInterval=6
```

### 9. Hardware Considerations
**Approach:** Check Raspberry Pi Bluetooth hardware
- Verify Bluetooth adapter is working: `hcitool dev`
- Check signal strength: `hcitool rssi <MAC>`
- Try external USB Bluetooth adapter (may have better Linux support)
- Check for interference or range issues

### 10. Debugging and Monitoring
**Approach:** Add more detailed logging
- Log exact timing of connection → discovery → disconnect
- Monitor BlueZ logs: `sudo journalctl -u bluetooth -f`
- Use `btmon` for detailed Bluetooth packet capture
- Compare successful macOS connection timing with Raspberry Pi

## Recommended Next Steps

1. **Immediate Actions:**
   - Try writing a dummy command immediately after connection (before discovery)
   - Check BlueZ logs for additional error details
   - Verify Bluetooth adapter power management settings

2. **Short-term Investigation:**
   - Capture Bluetooth packet traces with `btmon` to see exact disconnect reason
   - Compare connection timing between macOS (working) and Raspberry Pi (failing)
   - Test with different iLink device if available

3. **Long-term Solutions:**
   - Consider alternative BLE library if current approach doesn't work
   - Implement connection pooling to maintain persistent connections
   - Create device-specific connection handler if sequence is critical

## Testing Commands

```bash
# Check Bluetooth adapter status
sudo hciconfig hci0

# Monitor Bluetooth events
sudo btmon

# Check BlueZ logs
sudo journalctl -u bluetooth -f

# Test BLE scan
sudo hcitool lescan

# Check connection parameters
sudo hcitool con

# Monitor system logs for bridge
sudo journalctl -u ilink-bridge -f
```

## References

- [Bluetooth Error Code 62](https://e2e.ti.com/support/wireless-connectivity/bluetooth-group/bluetooth/f/bluetooth-forum/507372/connection-failure---reason-8-and-reason-62)
- [Noble Library Issues](https://github.com/noble/noble/issues)
- [BlueZ Documentation](https://git.kernel.org/pub/scm/bluetooth/bluez.git/tree/doc)

## Notes

- The device works on macOS, confirming the issue is platform-specific (Linux/Raspberry Pi)
- Error 62 suggests the device is timing out waiting for GATT activity
- All attempted solutions focused on timing and discovery, but the root cause may be deeper in the Linux BLE stack
- Consider that the device may require a specific initialization sequence that works on macOS but not Linux
