#!/bin/bash
# Script to set up ilink bridge as a systemd service
# Run with: sudo ./scripts/setup-service.sh

set -e

USER=$(whoami)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SERVICE_NAME="ilink-bridge"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

echo "Setting up ilink bridge as a systemd service..."
echo "Project directory: $PROJECT_DIR"
echo "User: $USER"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run with sudo:"
    echo "  sudo $0"
    exit 1
fi

# Find Node.js path (try common locations)
NODE_PATH=$(command -v node || echo "")
if [ -z "$NODE_PATH" ]; then
    # Try common installation paths
    if [ -f "/usr/bin/node" ]; then
        NODE_PATH="/usr/bin/node"
    elif [ -f "/usr/local/bin/node" ]; then
        NODE_PATH="/usr/local/bin/node"
    else
        echo "Error: Node.js not found. Please install Node.js first."
        echo "Common locations: /usr/bin/node, /usr/local/bin/node"
        exit 1
    fi
fi

echo "Using Node.js at: $NODE_PATH"
NODE_VERSION=$($NODE_PATH --version)
echo "Node.js version: $NODE_VERSION"
echo ""

# Check if dist/index.js exists
if [ ! -f "$PROJECT_DIR/dist/index.js" ]; then
    echo "Warning: dist/index.js not found. Building project..."
    cd "$PROJECT_DIR"
    if command -v yarn &> /dev/null; then
        yarn build
    elif command -v npm &> /dev/null; then
        npm run build
    else
        echo "Error: Neither yarn nor npm found. Please build manually first."
        exit 1
    fi
fi

# Check if .env file exists
if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo "Warning: .env file not found at $PROJECT_DIR/.env"
    echo "Please create it before starting the service."
    echo "You can copy .env.example: cp $PROJECT_DIR/.env.example $PROJECT_DIR/.env"
fi

# Create systemd service file
echo "Creating systemd service file..."
cat > "$SERVICE_FILE" << EOF
[Unit]
Description=iLink Home Assistant Bridge
After=network.target bluetooth.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$PROJECT_DIR
Environment="NODE_ENV=production"
Environment="PATH=/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin"
ExecStart=$NODE_PATH $PROJECT_DIR/dist/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Security settings
NoNewPrivileges=true
PrivateTmp=true

# Note: On Linux, BLE typically requires root or capabilities
# If you encounter permission errors, you may need to:
# 1. Run service as root (change User=root above), or
# 2. Set capabilities: sudo setcap cap_net_raw+eip $NODE_PATH

[Install]
WantedBy=multi-user.target
EOF

echo "Service file created at $SERVICE_FILE"
echo ""

# Reload systemd
echo "Reloading systemd..."
systemctl daemon-reload

# Enable service
echo "Enabling service to start on boot..."
systemctl enable $SERVICE_NAME

echo ""
echo "Service setup complete!"
echo ""
echo "IMPORTANT: On Linux, Bluetooth Low Energy typically requires root privileges."
echo "If the service fails to connect to devices, you may need to:"
echo "  1. Run as root: Edit $SERVICE_FILE and change 'User=$USER' to 'User=root'"
echo "  2. Or set capabilities: sudo setcap cap_net_raw+eip $NODE_PATH"
echo ""
echo "Useful commands:"
echo "  Start service:     sudo systemctl start $SERVICE_NAME"
echo "  Stop service:      sudo systemctl stop $SERVICE_NAME"
echo "  Restart service:   sudo systemctl restart $SERVICE_NAME"
echo "  Check status:      sudo systemctl status $SERVICE_NAME"
echo "  View logs:         sudo journalctl -u $SERVICE_NAME -f"
echo "  View recent logs:  sudo journalctl -u $SERVICE_NAME -n 50"
echo "  Disable on boot:   sudo systemctl disable $SERVICE_NAME"
echo ""
