# Why macOS Works But Raspberry Pi Doesn't

## The Retry You're Seeing

The retry is happening because:
1. **Living Room Light connects successfully** (~41 seconds)
2. **Bedroom Light connection times out** (60 seconds) - the adapter can't establish a second connection while the first is active
3. **Retry logic kicks in** - the code automatically retries up to 3 times

The retry is in `src/ble-manager.ts` - it's designed to handle transient connection failures, but in this case, it's hitting a fundamental hardware limitation.

## Why macOS Doesn't Have This Limitation

### macOS (CoreBluetooth)
- **Mature, well-tested stack** - Apple's CoreBluetooth has been refined over many years
- **Excellent concurrent connection support** - Can handle multiple BLE connections simultaneously
- **Better resource management** - Efficiently manages Bluetooth adapter resources
- **Hardware abstraction** - Works with various Bluetooth adapters seamlessly
- **Optimized for desktop/laptop use** - Designed for scenarios with multiple connected devices

### Raspberry Pi (BlueZ)
- **Linux Bluetooth stack** - BlueZ is open-source and has limitations
- **Limited concurrent connection support** - Many adapters struggle with multiple BLE connections
- **Hardware constraints** - Built-in Bluetooth adapters (often Broadcom) have firmware limitations
- **Resource limitations** - Less memory/processing power than desktop systems
- **Designed for different use cases** - Originally optimized for single connections

## The Root Cause

The Raspberry Pi's Bluetooth adapter appears to be **single-connection only** for BLE devices. When you try to connect to a second device while the first is connected:

1. The connection attempt hangs (doesn't fail immediately)
2. After 60 seconds, it times out
3. The retry logic tries again, but will likely fail for the same reason

## Solutions

### Option 1: Disconnect/Reconnect Strategy (Current Implementation)
- Disconnect first device before connecting second
- Connect to second device
- Reconnect first device
- **Pros**: Works around the limitation
- **Cons**: Temporary disconnection, more complex code

### Option 2: Accept Single Connection
- Only connect to one device at a time
- **Pros**: Simple, reliable
- **Cons**: Can't control both lights simultaneously

### Option 3: External USB Bluetooth Adapter
- Use a USB Bluetooth adapter with better Linux support
- **Pros**: May support concurrent connections
- **Cons**: Additional hardware cost, may still have limitations

### Option 4: ESP32 BLE Proxy (From Action Plan)
- Use ESP32 as BLE proxy
- ESP32 connects to lights, Raspberry Pi connects to ESP32 via MQTT/HTTP
- **Pros**: Very reliable, no BlueZ quirks
- **Cons**: Additional hardware and complexity

## Current Status

The code I just added implements Option 1 - it will:
1. Disconnect the first device before connecting the second
2. Connect to the second device
3. Reconnect the first device

This should allow both devices to be connected, though there will be a brief disconnection period during startup.

## Testing

After rebuilding, you should see:
- `[Main] Temporarily disconnecting X device(s)...`
- `[Main] Temporarily disconnected <device>`
- Connection to second device succeeds
- `[Main] Reconnecting previously disconnected device(s)...`
- `[Main] Successfully reconnected <device>`

Both devices should end up connected, though the first will be briefly disconnected during the second device's connection.
