#!/bin/bash
# Script to check Bluetooth HCI devices and help troubleshoot service discovery issues
# Usage: sudo ./scripts/check-bluetooth.sh

echo "=== Bluetooth HCI Device Check ==="
echo ""

echo "HCI Devices:"
hciconfig

echo ""
echo "=== Checking for multiple HCI devices ==="
HCI_COUNT=$(hciconfig | grep -c "^hci")
echo "Found $HCI_COUNT HCI device(s)"

if [ "$HCI_COUNT" -gt 1 ]; then
    echo ""
    echo "⚠️  WARNING: Multiple HCI devices detected!"
    echo "This can cause service discovery to hang on Linux."
    echo ""
    echo "To fix, disable unused HCI devices:"
    echo "  sudo hciconfig hci1 down  # Example: disable hci1 if not needed"
    echo ""
    echo "Or configure your system to use only one HCI device."
else
    echo "✓ Only one HCI device - this is good"
fi

echo ""
echo "=== RF-kill Status ==="
rfkill list bluetooth

echo ""
echo "=== Bluetooth Service Status ==="
systemctl status bluetooth --no-pager -l | head -20

echo ""
echo "=== Recommendations ==="
echo "1. Ensure only one HCI device is active (disable unused ones)"
echo "2. Make sure Bluetooth service is running: sudo systemctl start bluetooth"
echo "3. Check device is in range and powered on"
echo "4. Try running the bridge with: sudo node dist/index.js"
