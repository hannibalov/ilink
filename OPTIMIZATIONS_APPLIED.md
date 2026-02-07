# BLE Concurrent Connection Optimizations Applied

This document tracks all software optimizations applied to enable multiple concurrent BLE connections on Raspberry Pi.

## Summary of Changes

### 1. BlueZ Configuration Optimization ✅

**File**: `scripts/optimize-ble-concurrency.sh`

**Changes**:
- Optimized connection intervals (Min: 6, Max: 12) for better concurrent connection scheduling
- Disabled power management to prevent adapter from sleeping
- Enabled FastConnectable mode for quicker connections
- Set LE-only mode for better BLE support
- Optimized CPU governor to performance mode (if available)

**Usage**:
```bash
sudo ./scripts/optimize-ble-concurrency.sh
```

**Expected Impact**: Better connection scheduling and reduced power management interference.

---

### 2. Parallel Connection Attempts ✅

**File**: `src/index.ts`

**Changes**:
- Changed from sequential to parallel connection attempts
- All devices attempt to connect simultaneously first
- Falls back to sequential connections only if parallel fails
- Reduced sequential delay from 5s to 2s (with optimizations)

**Rationale**: Tests if the adapter can handle concurrent connections. If it can, all devices connect quickly. If not, falls back to sequential.

**Code Location**: Lines 87-148 in `src/index.ts`

---

### 3. Optimized MTU Exchange ✅

**File**: `src/device.ts`

**Changes**:
- Reduced MTU from 247 to 185 bytes for concurrent connections
- Smaller MTU reduces controller load, allowing better scheduling
- Added delay after MTU exchange before GATT discovery

**Rationale**: Smaller MTU reduces per-connection overhead, making it easier for the controller to handle multiple connections.

**Code Location**: Lines 95-128 in `src/device.ts`

---

### 4. Optimized GATT Discovery Timeouts ✅

**File**: `src/device.ts`

**Changes**:
- Increased service discovery timeout from 3s to 5s
- Increased characteristic discovery timeout from 3s to 5s
- Still fail-fast but allows controller time to schedule between devices

**Rationale**: Concurrent connections require the controller to schedule GATT operations across multiple devices. Slightly longer timeouts account for this scheduling overhead while still failing fast on real errors.

**Code Location**: 
- Service discovery: Line 179 in `src/device.ts`
- Characteristic discovery: Line 243 in `src/device.ts`

---

### 5. Connection Parameter Handling ✅

**File**: `src/device.ts`

**Changes**:
- Immediate MTU exchange after connection
- Small delay (100ms) after MTU before GATT discovery
- Prevents connection parameter conflicts

**Rationale**: Establishes connection parameters quickly to prevent one device from starving others.

**Code Location**: Lines 129-130 in `src/device.ts`

---

### 6. Alternative node-ble Implementation 🔄

**Files**: 
- `src/ble-manager-nodeble.ts`
- `src/device-nodeble.ts`

**Status**: Created but not yet integrated

**Purpose**: Alternative implementation using `node-ble` library which:
- Uses D-Bus directly (better BlueZ integration)
- May have better concurrent connection support
- More modern API

**To Use**:
1. Install: `npm install node-ble`
2. Update `src/index.ts` to import from `./ble-manager-nodeble` instead of `./ble-manager`
3. Test concurrent connections

**Note**: This is experimental and requires testing.

---

## Testing Instructions

### Step 1: Apply BlueZ Optimizations

```bash
sudo ./scripts/optimize-ble-concurrency.sh
```

### Step 2: Rebuild and Test

```bash
npm run build
sudo npm start
```

### Step 3: Monitor Results

Watch the logs for:
- Parallel connection attempts
- Success/failure of each device
- Connection timing

### Step 4: If Parallel Fails, Test Sequential Fallback

The code will automatically fall back to sequential connections if parallel fails. Monitor logs to see which approach works.

### Step 5: Test node-ble Alternative (Optional)

If noble-based optimizations don't work:

1. Install node-ble:
   ```bash
   npm install node-ble
   ```

2. Update `src/index.ts`:
   ```typescript
   // Change this line:
   import { BLEManager } from './ble-manager';
   // To:
   import { BLEManagerNodeBle as BLEManager } from './ble-manager-nodeble';
   ```

3. Rebuild and test:
   ```bash
   npm run build
   sudo npm start
   ```

---

## Expected Outcomes

### Best Case Scenario
- All devices connect successfully in parallel
- No timeouts or connection failures
- Stable concurrent operation

### Moderate Success
- Some devices connect in parallel
- Others require sequential fallback
- All devices eventually connect

### Limited Success
- Only one device connects (hardware limitation)
- Parallel attempts fail, sequential also fails for second device
- May require hardware solution (USB adapter or ESP32)

---

## Monitoring and Debugging

### Check BlueZ Status
```bash
sudo systemctl status bluetooth
journalctl -u bluetooth -f
```

### Check Adapter Status
```bash
hciconfig hci0
```

### Monitor Connection Attempts
Watch the application logs for:
- `[Main] Attempting parallel connections...`
- `[Main] ✓ Successfully connected to...`
- `[Main] Parallel connections: X/Y succeeded`
- `[Main] Attempting sequential connections...`

---

## Next Steps if Optimizations Don't Work

1. **Test USB Bluetooth Adapter**: Try a known-good adapter (Intel AX200, Realtek RTL8761B)
2. **ESP32 BLE Proxy**: Most reliable solution for production
3. **Connection Serialization**: Implement smart switching as fallback (see `SOFTWARE_SOLUTIONS.md`)

---

## Files Modified

- `src/index.ts` - Parallel connection logic
- `src/device.ts` - MTU and timeout optimizations
- `scripts/optimize-ble-concurrency.sh` - BlueZ configuration script (new)
- `src/ble-manager-nodeble.ts` - Alternative implementation (new)
- `src/device-nodeble.ts` - Alternative device implementation (new)

---

## Notes

- All optimizations are backward compatible
- BlueZ configuration persists until reboot (CPU governor may need systemd service for persistence)
- node-ble implementation is experimental and may require API adjustments
- Monitor system resources during testing (CPU, memory, Bluetooth adapter load)
