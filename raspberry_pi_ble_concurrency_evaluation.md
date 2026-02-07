# Raspberry Pi BLE Concurrent Connection Limitation — Evaluation & Options

## Context

- BLE lights connect successfully on **macOS**
- Same Node.js + MQTT bridge on **Raspberry Pi (Linux / BlueZ)** fails when connecting to more than one device
- First BLE device connects reliably
- Second BLE device connection **hangs / times out (~60s)**
- No explicit error, retry logic does not help

---

## Initial Hypothesis

> Raspberry Pi Bluetooth adapters (built-in Broadcom) only support **one active BLE connection**.

This hypothesis explains the observed behavior but is **not universally true**.  
Further analysis shows the issue is **device + stack + library interaction**, not a hard Pi limit.

---

## What Has Been Proven

### ✅ Proven

- Scanning is **not** the issue
- Timing/delays do **not** fix the issue
- Only one device can remain connected *with the current setup*
- macOS handles the same devices concurrently without issues

### ❌ Not Proven

- Raspberry Pi hardware supports only one BLE connection
- BlueZ is fundamentally single-connection
- USB Bluetooth will always fix the issue

---

## What Is Actually Happening

The failure is caused by a combination of:

- BLE light firmware assumptions (single-central bias)
- BlueZ connection scheduling behavior
- Node BLE library limitations (especially `noble`)
- Aggressive connection parameters requested by the first device

This can starve the controller of connection events for additional devices.

---

## Hardware-Based Solutions

### Option 1: Accept Single Connection (Baseline)

- One BLE device connected at a time
- Simple and reliable
- No concurrent control

### Option 2: External USB Bluetooth Adapter

**May help, not guaranteed**.

#### Likely to Work
- Intel AX200 / AX210 (USB or PCIe via adapter)
- Realtek RTL8761B (e.g. TP-Link UB500)

#### Likely NOT to Work
- CSR8510-based adapters
- Unbranded / cheap “Bluetooth 5.0” sticks

Pros:
- Minimal architecture change

Cons:
- Library limitations may still block concurrency
- Trial-and-error hardware cost

### Option 3: ESP32 BLE Proxy (Most Reliable)

Architecture:
```
BLE Lights ←→ ESP32 (BLE Central)
               ↓
           MQTT / HTTP
               ↓
        Raspberry Pi
               ↓
        Home Assistant
```

Pros:
- Designed for multi-connection BLE
- No BlueZ quirks
- Widely used in HA ecosystem

Cons:
- Additional firmware and hardware

---

## Software-Based Solutions (Before Buying Hardware)

### 1. Change Node BLE Library

#### Replace `noble`

`noble` has known limitations with:
- Concurrent connections
- Connection parameter negotiation

Alternatives:

##### node-ble
- Modern API
- Better BlueZ integration
- Uses D-Bus instead of raw HCI

##### dbus-native + BlueZ
- Direct control of `org.bluez`
- More verbose but precise
- Best visibility into failures

##### Python (for validation)
- `bleak`
- Good reference for concurrency behavior
- Helps isolate Node-specific issues

---

### 2. Force Connection Parameter Control

Some devices request aggressive parameters that block others.

Possible mitigations:
- Force MTU exchange immediately
- Limit connection interval
- Avoid full GATT discovery

This requires:
- Library support (often missing in noble)
- Or direct BlueZ D-Bus calls

---

### 3. Disable Built-in Bluetooth Power Management

```bash
sudo hciconfig hci0 up
sudo hciconfig hci0 noscan
```

Also ensure:
- CPU governor is not set to aggressive power-saving
- Bluetooth service is stable

---

### 4. BlueZ Configuration Tweaks

Edit:
```bash
sudo nano /etc/bluetooth/main.conf
```

Suggested settings:
```ini
[General]
ControllerMode = le
FastConnectable = true

[LE]
MinConnectionInterval = 6
MaxConnectionInterval = 12
ConnectionLatency = 0
SupervisionTimeout = 500
```

Restart:
```bash
sudo systemctl restart bluetooth
sudo reboot
```

---

### 5. Use Cached Handles / Skip Discovery

If UUIDs are known:
- Skip full GATT discovery
- Use cached characteristic handles
- Immediately perform read/write

Reduces controller load significantly.

---

### 6. Connection Serialization (Soft Multiplexing)

- Maintain one active BLE connection
- Switch connections on demand
- Queue commands per device

Pros:
- No extra hardware

Cons:
- Latency
- Complex state machine

---

## When a USB Adapter Is Worth Trying

- Minimal architecture change desired
- Known-good chipset available
- Willing to experiment

If chosen:
- Disable built-in adapter (`hci0`)
- Use a single controller
- Verify adapter exposes multiple LE links

---

## Final Recommendation

### Production / Long-Term
➡️ **ESP32 BLE Proxy**

### Experimental / Short-Term
➡️ Try **one high-quality USB adapter**
➡️ Or migrate away from `noble`

### Architectural Truth
➡️ Raspberry Pi excels as **logic + MQTT hub**
➡️ BLE central role scales poorly on Linux

---

## Summary

- This is **not** a simple Raspberry Pi hardware limit
- It is a **stack + firmware + library interaction**
- USB Bluetooth *may* help but is not guaranteed
- ESP32-based BLE offloading is the most robust solution

---
