# Software Solutions for Concurrent BLE Connections

This document tracks all software-based solutions attempted to enable multiple concurrent BLE connections on Raspberry Pi.

## Solution 1: BlueZ Configuration Optimization ✅

**Status**: Implemented

**Changes**:
- Optimized connection intervals (Min: 6, Max: 12)
- Disabled power management
- Set FastConnectable mode
- Configured LE-only mode

**Script**: `scripts/optimize-ble-concurrency.sh`

**Usage**:
```bash
sudo ./scripts/optimize-ble-concurrency.sh
```

**Expected Impact**: May improve connection stability and allow better scheduling of multiple connections.

---

## Solution 2: Migrate from noble to node-ble 🔄

**Status**: In Progress

**Rationale**: 
- `@abandonware/noble` has known limitations with concurrent connections
- `node-ble` uses D-Bus directly, providing better BlueZ integration
- Better connection parameter control
- More modern API with better error handling

**Changes Required**:
- Replace `@abandonware/noble` with `@abandonware/node-ble`
- Update `BLEManager` class
- Update `ILinkDevice` class
- Adjust connection/discovery logic

**Package**: `@abandonware/node-ble`

---

## Solution 3: Connection Parameter Control 🔄

**Status**: In Progress

**Goal**: Force optimal connection parameters to prevent one device from starving others.

**Implementation**:
- Set MTU immediately after connection
- Limit connection interval range
- Avoid aggressive connection parameters
- Use connection parameter update requests

**Library Support**: Requires library that supports connection parameter control (node-ble does).

---

## Solution 4: Optimize GATT Discovery 🔄

**Status**: In Progress

**Goal**: Reduce controller load by skipping unnecessary discovery.

**Implementation**:
- Cache characteristic handles after first discovery
- Skip full service discovery if UUIDs are known
- Use direct characteristic access when possible
- Reduce discovery timeouts

---

## Solution 5: Connection Serialization (Fallback) ⏳

**Status**: Not Started

**Goal**: If true concurrency isn't possible, implement smart switching.

**Implementation**:
- Maintain one active connection
- Queue commands per device
- Switch connections on-demand
- Transparent to MQTT layer

**Use Case**: Last resort if hardware truly doesn't support concurrent connections.

---

## Testing Strategy

1. **Test Solution 1** (BlueZ config):
   - Run optimization script
   - Test with 2 devices
   - Monitor connection success rate

2. **Test Solution 2** (node-ble migration):
   - Migrate code
   - Test with 2 devices
   - Compare with noble results

3. **Test Solution 3** (Connection parameters):
   - Implement parameter control
   - Test with 2 devices
   - Monitor connection stability

4. **Test Solution 4** (GATT optimization):
   - Implement caching
   - Test with 2 devices
   - Measure discovery time

5. **Test Solution 5** (Serialization):
   - Only if all above fail
   - Implement switching logic
   - Test latency and reliability

---

## Progress Tracking

- [x] BlueZ configuration script created
- [ ] BlueZ configuration tested
- [ ] node-ble migration started
- [ ] node-ble migration completed
- [ ] Connection parameter control implemented
- [ ] GATT discovery optimization implemented
- [ ] All solutions tested
- [ ] Documentation updated

---

## Notes

- These solutions are attempted before considering hardware changes
- Each solution builds on the previous ones
- Some solutions may require root access
- Monitor system logs during testing: `journalctl -u bluetooth -f`
