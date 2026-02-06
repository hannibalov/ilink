#!/bin/bash
# Script to find how smart-home app is configured to start at boot

echo "Searching for smart-home startup configuration..."
echo ""

# Check systemd services
echo "=== Checking systemd services ==="
systemctl list-unit-files | grep -i "smart\|home\|egin" || echo "No matching systemd services found"
echo ""

# Check for specific service files
echo "=== Checking for service files ==="
find /etc/systemd/system -name "*smart*" -o -name "*home*" -o -name "*egin*" 2>/dev/null | while read file; do
    echo "Found: $file"
    echo "Status:"
    systemctl status $(basename $file) --no-pager | head -3 || true
    echo ""
done

# Check crontab
echo "=== Checking crontab ==="
crontab -l 2>/dev/null | grep -i "smart\|home\|egin" || echo "No matching cron jobs found"
echo ""

# Check rc.local
echo "=== Checking /etc/rc.local ==="
if [ -f /etc/rc.local ]; then
    grep -i "smart\|home\|egin" /etc/rc.local || echo "No matching entries found"
else
    echo "/etc/rc.local not found"
fi
echo ""

# Check for PM2
echo "=== Checking PM2 ==="
if command -v pm2 &> /dev/null; then
    pm2 list | grep -i "smart\|home\|egin" || echo "No matching PM2 processes found"
else
    echo "PM2 not installed"
fi
echo ""

# Check for running node processes
echo "=== Checking running Node.js processes ==="
ps aux | grep node | grep -v grep | grep -i "smart\|home\|egin" || echo "No matching Node.js processes found"
echo ""

echo "Done. Look for any matches above and disable them accordingly."
