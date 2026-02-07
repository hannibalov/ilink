# Raspberry Pi Single BLE Connection Limitation

## The Real Problem

After extensive testing, we've discovered that **Raspberry Pi Bluetooth adapters (especially built-in Broadcom) support only ONE active BLE connection at a time**.

This is NOT about scanning - it's about **maintaining concurrent connections**.

## What We've Tried

### 1. Temporary Disconnect/Reconnect Approach ❌
- **Attempt**: Disconnect device 1 → Connect device 2 → Reconnect device 1
- **Result**: Device 2 connects successfully, but device 1 reconnection times out
- **Conclusion**: Adapter cannot maintain two connections simultaneously

### 2. Scan-All-First Approach ❌  
- **Attempt**: Scan all devices upfront, then connect sequentially without scanning
- **Result**: First device connects, second device connection times out (60 seconds)
- **Conclusion**: Not a scanning issue - it's a connection concurrency limitation

### 3. Increased Timeouts and Delays ❌
- **Attempt**: Longer timeouts, delays between connections
- **Result**: Still times out - the adapter simply cannot establish a second connection
- **Conclusion**: Timing is not the issue - it's a fundamental hardware limitation

## Why macOS Works

**macOS CoreBluetooth:**
- Mature, well-tested stack
- Excellent concurrent connection support
- Can handle multiple BLE devices simultaneously
- Works with various Bluetooth adapters seamlessly

**Raspberry Pi BlueZ:**
- Linux Bluetooth stack with limitations
- Built-in adapters (often Broadcom) have firmware/hardware constraints
- **Single connection limitation** - appears to be hardcoded in firmware
- Designed for different use cases (originally single connection)

## Current Behavior

With the current code:
1. ✅ First device connects successfully
2. ❌ Second device connection times out after 60 seconds
3. 🔄 Retry logic attempts again (will likely fail for same reason)

**Only the first device that connects will remain connected.**

## Realistic Solutions

### Option 1: Accept Single Connection (Current)
- Connect to first device only
- **Pros**: Simple, works reliably
- **Cons**: Can't control both lights simultaneously

### Option 2: External USB Bluetooth Adapter
- Use a USB Bluetooth adapter with better Linux support
- **Pros**: May support concurrent connections
- **Cons**: Additional hardware cost (~$10-20), may still have limitations
- **Recommendation**: Try a well-reviewed adapter like:
  - ASUS USB-BT400
  - TP-Link UB400
  - Check reviews for Linux/BLE concurrent connection support

### Option 3: ESP32 BLE Proxy (Most Reliable)
- Use ESP32 as BLE proxy (connects to lights)
- Raspberry Pi connects to ESP32 via MQTT/HTTP
- **Pros**: Very reliable, no BlueZ quirks, proven solution
- **Cons**: Additional hardware (~$5-10), requires ESP32 programming
- **Architecture**: 
  ```
  Lights ←→ ESP32 (BLE) ←→ MQTT/HTTP ←→ Raspberry Pi ←→ Home Assistant
  ```

### Option 4: Connection Manager (Switch Between Devices)
- Implement a connection manager that switches between devices as needed
- When command comes for device 2, disconnect device 1, connect device 2, send command, reconnect device 1
- **Pros**: Both devices "work" (with switching overhead)
- **Cons**: Temporary disconnections, complex code, not true concurrent control

## Recommendation

**For production use**: **ESP32 BLE Proxy** (Option 3)
- Most reliable solution
- Common pattern in Home Assistant community
- No BlueZ quirks
- Supports multiple concurrent connections

**For quick testing**: **External USB Bluetooth Adapter** (Option 2)
- Easier to try than ESP32
- May work, may not (depends on adapter)
- Worth trying if you want to avoid ESP32 complexity

**For now**: **Accept single connection** (Option 1)
- Code works for one device
- Can add second device later when hardware solution is in place

## Testing External USB Adapter

If you want to try an external adapter:

1. **Purchase adapter** (check Linux/BLE reviews)
2. **Disable built-in adapter**:
   ```bash
   sudo systemctl stop bluetooth
   sudo hciconfig hci0 down
   ```
3. **Plug in USB adapter** (should appear as hci1)
4. **Configure noble to use USB adapter** (may require code changes)
5. **Test concurrent connections**

## Summary

The Raspberry Pi's built-in Bluetooth adapter has a **hardware/firmware limitation** that prevents concurrent BLE connections. This is not a code bug - it's a known limitation of many Broadcom Bluetooth adapters on Linux.

The best solution is to use an ESP32 BLE proxy or an external USB Bluetooth adapter that supports concurrent connections.
