# Raspberry Pi BLE Disconnect (Error 62) — Action Plan & Next Steps

## Context

- BLE lights connect **successfully on macOS**
- Same Node.js + MQTT bridge **fails on Raspberry Pi (Linux / BlueZ)**
- Failure happens immediately after connection or during service discovery
- Error observed: **0x3E / 62 — Connection Failed to be Established**

This strongly suggests a **platform-specific BLE handshake mismatch** between macOS CoreBluetooth and Linux BlueZ.

---

## Key Insight

macOS sends **implicit early GATT/ATT traffic** (MTU exchange, reads/writes) immediately after connection.  
BlueZ **does not**, unless explicitly instructed.

Some BLE devices (especially lights / IoT) **require activity within a very short window** (<300–500ms) or they disconnect.

This is **not a retry/delay problem**.

---

## Highest-Value Next Steps (In Order)

## 1. Capture the Working macOS Handshake (CRITICAL)

### Tool
- **PacketLogger** (Xcode → Additional Tools)

### Steps
1. Open PacketLogger
2. Start capture
3. Connect to the BLE light using the working macOS Node app
4. Save the trace

### What to Look For
- First ATT packet after `LE Connection Complete`
- MTU exchange timing
- Any immediate:
  - Read Request
  - Write Command
  - Write Request
- Whether service discovery is *not* the first action

This defines the **minimum required handshake**.

---

## 2. Capture Raspberry Pi BLE Traffic

### Tool
```bash
sudo btmon
```

### Compare Against macOS
- Time from connection → first ATT packet
- MTU exchange (present vs missing)
- Disconnect reason timing

Goal: find **one missing early packet**.

---

## 3. Force Immediate MTU Exchange (Often Fixes Error 62)

BlueZ does **not** auto-negotiate MTU.

### Required Change
Immediately request MTU after connection, *before* discovery.

### Noble-Style Example
```ts
peripheral.connect(err => {
  if (err) return fail(err);

  peripheral.exchangeMtu(247, () => {
    peripheral.discoverSomeServicesAndCharacteristics(
      [SERVICE_UUID],
      [KNOWN_CHAR_UUID],
      onDiscovered
    );
  });
});
```

If characteristic UUIDs are not known yet:
```ts
peripheral.exchangeMtu(247, () => {
  peripheral.discoverServices([SERVICE_UUID], onServices);
});
```

---

## 4. Stop Full GATT Discovery on Linux

### Do NOT use
- discoverAllServicesAndCharacteristics()

### Instead
- Hardcode:
  - Service UUID(s)
  - Characteristic UUID(s)
  - Write type (with / without response)

Many BLE firmwares **cannot handle full enumeration**.  
macOS tolerates this; Linux often does not.

---

## 5. Send an Immediate Dummy GATT Operation

If MTU alone is insufficient:

### Strategy
Immediately send a **read or write** to a known characteristic.

Even a failed write is enough to keep the connection alive.

```ts
characteristic.write(Buffer.from([0x00]), false);
```

---

## 6. BlueZ Configuration Hardening

Edit:
```bash
sudo nano /etc/bluetooth/main.conf
```

### Recommended Settings
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

Then:
```bash
sudo systemctl restart bluetooth
sudo reboot
```

---

## 7. Sanity Check with Raw BlueZ (No Node)

Use `dbus-native` or Python (`bleak`):

- Connect
- Immediate write
- Observe disconnect behavior

If this works → Node BLE abstraction issue  
If it fails → Device firmware is Linux-hostile

---

## 8. Reliable Fallback: ESP32 BLE Proxy

### Architecture
ESP32 (BLE Central) → MQTT / HTTP → Raspberry Pi → Home Assistant

### Pros
- Very reliable
- No BlueZ quirks
- Cheap

### Cons
- Extra hardware

This is common in production Home Assistant setups.

---

## Recommended Execution Order

1. Capture macOS PacketLogger trace
2. Compare with btmon output
3. Force MTU exchange immediately
4. Skip full discovery
5. Add immediate dummy write
6. Test raw BlueZ
7. Decide on ESP32 proxy if needed

---

## Summary

- Error 62 is a **handshake timing failure**
- macOS sends packets BlueZ does not
- Fix is usually **one missing early ATT operation**
- Retries and delays will not fix this

---
