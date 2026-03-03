# iLink -- Critical BLE Lifecycle Fixes + Home Assistant Configuration

This document addresses the current runtime failure:

    Service discovery attempt 1 failed: Peripheral not connected before discovery
    Failed to connect: Peripheral disconnected - need fresh reference

This is NOT an MQTT issue. This is a BLE lifecycle / stale peripheral
reference issue.

------------------------------------------------------------------------

# ROOT CAUSE

You are connecting to a cached Peripheral instance discovered during
startup scan.

With noble / @abandonware/noble:

A Peripheral object MUST come from the SAME scan session used for
connection. You cannot reuse Peripheral objects across scans. You cannot
cache Peripheral references long-term.

BlueZ will silently disconnect stale references.

------------------------------------------------------------------------

# REQUIRED CODE CHANGES

## 1 Remove Peripheral Caching

Delete any structure like:

cachedDevices\[mac\] = peripheral

And stop reusing stored peripheral instances.

You may cache MAC addresses and metadata, but NEVER Peripheral objects.

------------------------------------------------------------------------

## 2 Replace connect logic with FRESH SCAN PER COMMAND

Create this helper in ble-manager.ts:

``` ts
import noble, { Peripheral } from '@abandonware/noble'

export async function findAndConnect(mac: string): Promise<Peripheral> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      noble.stopScanning()
      reject(new Error("Device not found during scan"))
    }, 10000)

    const onDiscover = async (peripheral: Peripheral) => {
      if (peripheral.address.toLowerCase() === mac.toLowerCase()) {
        clearTimeout(timeout)
        noble.removeListener("discover", onDiscover)
        noble.stopScanning()

        try {
          await peripheral.connectAsync()
          resolve(peripheral)
        } catch (err) {
          reject(err)
        }
      }
    }

    noble.on("discover", onDiscover)
    noble.startScanning([], false)
  })
}
```

------------------------------------------------------------------------

## 3 Use Short-Burst Pattern Properly

Replace your connect logic with:

``` ts
async function executeCommand(mac: string, payload: any) {
  const peripheral = await findAndConnect(mac)

  try {
    await peripheral.discoverAllServicesAndCharacteristicsAsync()

    // Your existing write logic here
    await sendColorCommand(peripheral, payload)

  } finally {
    await peripheral.disconnectAsync()
    await new Promise(r => setTimeout(r, 300))
  }
}
```

------------------------------------------------------------------------

## 4 Keep BLE Queue (Do NOT remove)

Ensure BLE operations are serialized:

``` ts
class BleQueue {
  private queue: Promise<void> = Promise.resolve()

  schedule(task: () => Promise<void>) {
    this.queue = this.queue.then(task).catch(console.error)
    return this.queue
  }
}
```

And in MQTT handler:

bleQueue.schedule(() =\> executeCommand(mac, payload))

------------------------------------------------------------------------

# IMPORTANT: REMOVE STARTUP SCAN CACHE USAGE

You may keep scanning at startup for visibility/logging, but:

Do NOT use those Peripheral instances for connection Do NOT store them
Do NOT reuse them

Only use scan results for logging MAC verification.

------------------------------------------------------------------------

# RASPBERRY SIDE CHECKLIST

## Ensure HA is NOT using Bluetooth

If Home Assistant is using the same adapter, it will interrupt noble
connections.

In Home Assistant:

Settings → Devices & Services → Bluetooth

If enabled → Disable it.

If running HA in Docker, remove Bluetooth access flags from HA
container.

You want ONLY ilink using BLE.

------------------------------------------------------------------------

## Verify Adapter

Run:

hciconfig

Ensure hci0 is UP RUNNING.

If not:

sudo hciconfig hci0 up

------------------------------------------------------------------------

# HOME ASSISTANT CONFIGURATION

If using MQTT integration, configuration is in:

/config/configuration.yaml

Add:

``` yaml
mqtt:
  light:
    - name: "Living Room"
      command_topic: "ilink/living_room/set"
      optimistic: true
      schema: json

    - name: "Bedroom"
      command_topic: "ilink/bedroom/set"
      optimistic: true
      schema: json
```

Restart Home Assistant.

------------------------------------------------------------------------

# WHY YOUR LOGS SHOW "No command handler set"

During startup:

\[MQTT\] No command handler set; ignoring command

This happens because: - HA restores previous state - It publishes
retained MQTT commands - Your bridge subscribes before handler fully
registers

This is harmless if it disappears after startup.

------------------------------------------------------------------------

# FINAL EXPECTED BEHAVIOR

After fixes:

1.  MQTT command received
2.  Fresh scan begins
3.  Device found
4.  Connect
5.  Discover services
6.  Write characteristic
7.  Disconnect
8.  Next queued command runs

No stale references. No "Peripheral not connected before discovery". No
multi-device conflicts.

------------------------------------------------------------------------

END OF DOCUMENT
