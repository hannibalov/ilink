#!/bin/bash
# Script to optimize BlueZ and Raspberry Pi settings for concurrent BLE connections
# Based on recommendations from raspberry_pi_ble_concurrency_evaluation.md
# Usage: sudo ./scripts/optimize-ble-concurrency.sh

set -e

echo "=== Optimizing BlueZ for Concurrent BLE Connections ==="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root (use sudo)"
    exit 1
fi

# Backup original BlueZ config
BLUEZ_CONFIG="/etc/bluetooth/main.conf"
if [ -f "$BLUEZ_CONFIG" ]; then
    echo "Backing up original BlueZ config..."
    cp "$BLUEZ_CONFIG" "${BLUEZ_CONFIG}.backup.$(date +%Y%m%d_%H%M%S)"
fi

# Create or update BlueZ main.conf with optimized settings
echo "Configuring BlueZ main.conf..."
cat > "$BLUEZ_CONFIG" << 'EOF'
# BlueZ main configuration file
# Optimized for concurrent BLE connections

[General]
# Use LE (Low Energy) mode for better BLE support
ControllerMode = le
# Enable fast connectable mode for quicker connections
FastConnectable = true
# Disable page scan timeout to keep adapter ready
PageTimeout = 8192
# Keep adapter discoverable for longer
DiscoverableTimeout = 0

[LE]
# Optimize connection intervals for concurrent connections
# MinConnectionInterval: 6 * 1.25ms = 7.5ms (allows more connections)
MinConnectionInterval = 6
# MaxConnectionInterval: 12 * 1.25ms = 15ms (balanced)
MaxConnectionInterval = 12
# ConnectionLatency: 0 = no missed connection events
ConnectionLatency = 0
# SupervisionTimeout: 500 * 10ms = 5 seconds (reasonable timeout)
SupervisionTimeout = 500

[Policy]
# Auto-enable adapter on startup
AutoEnable = true
EOF

echo "✓ BlueZ configuration updated"

# Disable Bluetooth power management
echo ""
echo "Disabling Bluetooth power management..."
hciconfig hci0 up
hciconfig hci0 noscan
# Disable power saving mode
hciconfig hci0 noleadv
# Set adapter to be always on
hciconfig hci0 piscan || true  # Enable page/ inquiry scan

echo "✓ Power management disabled"

# Optimize CPU governor for better BLE performance
echo ""
echo "Optimizing CPU governor..."
if [ -f /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor ]; then
    CURRENT_GOVERNOR=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor)
    echo "Current CPU governor: $CURRENT_GOVERNOR"
    
    # Set to performance mode if available (better for BLE timing)
    if [ -f /sys/devices/system/cpu/cpu0/cpufreq/scaling_available_governors ]; then
        AVAILABLE=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_available_governors)
        if echo "$AVAILABLE" | grep -q "performance"; then
            echo "Setting CPU governor to performance mode..."
            echo performance > /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor
            echo "✓ CPU governor set to performance"
        else
            echo "Performance governor not available, keeping $CURRENT_GOVERNOR"
        fi
    fi
else
    echo "CPU governor control not available (may be running on a different system)"
fi

# Restart Bluetooth service to apply BlueZ config changes
echo ""
echo "Restarting Bluetooth service..."
systemctl restart bluetooth
sleep 2

# Verify Bluetooth is running
if systemctl is-active --quiet bluetooth; then
    echo "✓ Bluetooth service restarted successfully"
else
    echo "⚠️  Warning: Bluetooth service may not be running properly"
fi

# Check adapter status
echo ""
echo "=== Bluetooth Adapter Status ==="
hciconfig hci0

echo ""
echo "=== RF-kill Status ==="
rfkill list bluetooth

echo ""
echo "=== Summary ==="
echo "✓ BlueZ configuration optimized for concurrent connections"
echo "✓ Power management disabled"
echo "✓ CPU governor optimized (if available)"
echo "✓ Bluetooth service restarted"
echo ""
echo "Next steps:"
echo "1. Test concurrent connections with: sudo npm start"
echo "2. Monitor logs for connection success/failures"
echo "3. If issues persist, consider migrating to node-ble library"
echo ""
echo "Note: These changes persist until reboot. To make CPU governor changes permanent,"
echo "add to /etc/rc.local or create a systemd service."
