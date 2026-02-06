#!/bin/bash
# Script to fix Bluetooth RF-kill issues on Raspberry Pi
# Usage: sudo ./scripts/fix-bluetooth.sh

echo "Checking RF-kill status..."
rfkill list

echo ""
echo "Unblocking Bluetooth..."
rfkill unblock bluetooth

echo ""
echo "Waiting 2 seconds..."
sleep 2

echo ""
echo "Powering on Bluetooth adapter..."
hciconfig hci0 up

echo ""
echo "Checking status..."
hciconfig hci0

echo ""
echo "Checking RF-kill status again..."
rfkill list

echo ""
echo "Done! Try running 'npm run scan' now."
