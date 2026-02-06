#!/bin/bash
# Script to find Home Assistant configuration.yaml location

echo "Searching for Home Assistant configuration.yaml..."
echo ""

# Common locations
LOCATIONS=(
    "/config/configuration.yaml"
    "~/.homeassistant/configuration.yaml"
    "/home/homeassistant/.homeassistant/configuration.yaml"
    "/usr/share/hassio/homeassistant/configuration.yaml"
    "/opt/homeassistant/configuration.yaml"
)

echo "Checking common locations:"
for loc in "${LOCATIONS[@]}"; do
    expanded=$(eval echo "$loc")
    if [ -f "$expanded" ]; then
        echo "✓ FOUND: $expanded"
        echo ""
        echo "To edit it, run:"
        echo "  sudo nano $expanded"
        exit 0
    else
        echo "✗ Not found: $expanded"
    fi
done

echo ""
echo "Not found in common locations. Searching entire system..."
echo "(This may take a moment)"
echo ""

# Search entire system
RESULT=$(find / -name "configuration.yaml" 2>/dev/null | grep -v proc | grep -v sys | head -5)

if [ -n "$RESULT" ]; then
    echo "Found configuration.yaml files:"
    echo "$RESULT"
    echo ""
    echo "The Home Assistant one is likely in /config/ or contains 'homeassistant' or 'hass'"
else
    echo "Could not find configuration.yaml"
    echo ""
    echo "Try these commands:"
    echo "  1. Check if Home Assistant is running:"
    echo "     sudo systemctl status home-assistant"
    echo ""
    echo "  2. Check Docker containers:"
    echo "     docker ps | grep homeassistant"
    echo ""
    echo "  3. Check Home Assistant OS:"
    echo "     ls -la /config/"
fi
