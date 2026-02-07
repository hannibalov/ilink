# Guide: Enabling Concurrent BLE Connections on Raspberry Pi

This guide walks you through all the software optimizations applied to enable multiple concurrent BLE connections on Raspberry Pi.

## Quick Start

### Step 1: Apply BlueZ Optimizations

Run the optimization script to configure BlueZ for concurrent connections:

```bash
sudo ./scripts/optimize-ble-concurrency.sh
```

This script:
- Optimizes BlueZ connection parameters
- Disables power management
- Sets CPU governor to performance mode
- Restarts Bluetooth service

**Note**: You may need to reboot after running this script for all changes to take effect.

### Step 2: Rebuild and Test

```bash
npm run build
sudo npm start
```

The code will now:
1. **First attempt**: Connect to all devices in parallel
2. **Fallback**: If parallel fails, connect sequentially with optimized timing

### Step 3: Monitor Results

Watch the logs for connection success. You should see:
```
[Main] Attempting parallel connections to test concurrent support...
[Main] ✓ Successfully connected to Device1
[Main] ✓ Successfully connected to Device2
[Main] ✓ All 2 devices connected successfully in parallel!
```

Or if parallel fails:
```
[Main] Parallel connections: 1/2 succeeded
[Main] Attempting sequential connections for remaining devices...
```

---

## What Was Changed

### 1. BlueZ Configuration (`scripts/optimize-ble-concurrency.sh`)

**Connection Parameters**:
- MinConnectionInterval: 6 (7.5ms)
- MaxConnectionInterval: 12 (15ms)
- ConnectionLatency: 0
- SupervisionTimeout: 500 (5 seconds)

**Rationale**: These parameters allow the controller to schedule connections more efficiently, making concurrent connections possible.

### 2. Parallel Connection Logic (`src/index.ts`)

**Before**: Devices connected sequentially with 5-second delays
**After**: All devices attempt to connect simultaneously first

**Benefits**:
- Tests if adapter supports concurrent connections
- Faster if concurrent works
- Automatic fallback if it doesn't

### 3. Optimized MTU (`src/device.ts`)

**Before**: MTU 247 bytes
**After**: MTU 185 bytes

**Rationale**: Smaller MTU reduces controller load per connection, making it easier to handle multiple connections.

### 4. Optimized Timeouts (`src/device.ts`)

**Before**: 
- Service discovery: 3 seconds
- Characteristic discovery: 3 seconds

**After**:
- Service discovery: 5 seconds
- Characteristic discovery: 5 seconds

**Rationale**: Concurrent connections require controller scheduling time. Slightly longer timeouts account for this while still failing fast on real errors.

### 5. Connection Parameter Handling (`src/device.ts`)

- Immediate MTU exchange after connection
- 100ms delay before GATT discovery
- Prevents connection parameter conflicts

---

## Alternative: node-ble Library

If the optimizations above don't work, try the alternative `node-ble` implementation:

### Step 1: Install node-ble

```bash
npm install node-ble
```

### Step 2: Switch Implementation

Edit `src/index.ts` and change:

```typescript
// From:
import { BLEManager } from './ble-manager';

// To:
import { BLEManagerNodeBle as BLEManager } from './ble-manager-nodeble';
```

### Step 3: Rebuild and Test

```bash
npm run build
sudo npm start
```

**Why node-ble?**
- Uses D-Bus directly (better BlueZ integration)
- May have better concurrent connection support
- More modern API

**Note**: The node-ble implementation is experimental and may require API adjustments.

---

## Troubleshooting

### Only One Device Connects

**Symptoms**: First device connects, second times out

**Possible Causes**:
1. BlueZ optimizations not applied
2. Hardware limitation (adapter doesn't support concurrent connections)
3. Power management interfering

**Solutions**:
1. Run `sudo ./scripts/optimize-ble-concurrency.sh` again
2. Check adapter status: `hciconfig hci0`
3. Try node-ble alternative
4. Consider USB Bluetooth adapter or ESP32 proxy

### Connection Timeouts

**Symptoms**: Devices found but connection times out

**Solutions**:
1. Check device proximity (move closer)
2. Check for interference (other Bluetooth devices)
3. Verify BlueZ service is running: `sudo systemctl status bluetooth`
4. Check logs: `journalctl -u bluetooth -f`

### BlueZ Configuration Not Applied

**Symptoms**: Script runs but changes don't take effect

**Solutions**:
1. Reboot Raspberry Pi: `sudo reboot`
2. Verify config: `cat /etc/bluetooth/main.conf`
3. Check service: `sudo systemctl restart bluetooth`

---

## Testing Checklist

- [ ] BlueZ optimization script run successfully
- [ ] Raspberry Pi rebooted (if needed)
- [ ] Code rebuilt: `npm run build`
- [ ] Bridge started: `sudo npm start`
- [ ] All devices found during scan
- [ ] Parallel connections attempted
- [ ] All devices connected successfully
- [ ] Commands work for all devices
- [ ] State updates work for all devices

---

## Expected Outcomes

### Best Case: All Devices Connect in Parallel ✅

```
[Main] Attempting parallel connections to test concurrent support...
[Main] ✓ Successfully connected to Device1
[Main] ✓ Successfully connected to Device2
[Main] ✓ All 2 devices connected successfully in parallel!
```

**Meaning**: Adapter supports concurrent connections! All optimizations working.

### Moderate Success: Sequential Fallback Works ✅

```
[Main] Parallel connections: 1/2 succeeded
[Main] Attempting sequential connections for remaining devices...
[Main] ✓ Successfully connected to Device2
```

**Meaning**: Adapter can handle multiple connections but needs sequential timing. Still functional.

### Limited Success: Only One Device Connects ⚠️

```
[Main] Parallel connections: 1/2 succeeded
[Main] Attempting sequential connections for remaining devices...
[Main] Failed to connect to Device2
```

**Meaning**: Hardware limitation. Consider:
- USB Bluetooth adapter
- ESP32 BLE proxy
- Connection serialization (see `SOFTWARE_SOLUTIONS.md`)

---

## Monitoring

### Check Bluetooth Adapter Status

```bash
hciconfig hci0
```

Look for:
- `UP RUNNING` - Adapter is active
- `LE` - LE mode enabled
- No power management flags

### Monitor BlueZ Logs

```bash
sudo journalctl -u bluetooth -f
```

Watch for:
- Connection events
- Errors
- Timeouts

### Monitor Application Logs

Watch for:
- Connection attempts
- Success/failure messages
- Timeout errors
- Retry attempts

---

## Next Steps

If concurrent connections still don't work after trying all software solutions:

1. **USB Bluetooth Adapter**: Try a known-good adapter (Intel AX200, Realtek RTL8761B)
2. **ESP32 BLE Proxy**: Most reliable solution for production
3. **Connection Serialization**: Implement smart switching (see `SOFTWARE_SOLUTIONS.md`)

---

## Files Modified

- `src/index.ts` - Parallel connection logic
- `src/device.ts` - MTU and timeout optimizations
- `scripts/optimize-ble-concurrency.sh` - BlueZ configuration (new)
- `src/ble-manager-nodeble.ts` - Alternative implementation (new)
- `src/device-nodeble.ts` - Alternative device implementation (new)

---

## References

- `OPTIMIZATIONS_APPLIED.md` - Detailed list of all optimizations
- `SOFTWARE_SOLUTIONS.md` - Complete solution tracking
- `raspberry_pi_ble_concurrency_evaluation.md` - Original evaluation
- `SINGLE_CONNECTION_LIMITATION.md` - Original problem description
