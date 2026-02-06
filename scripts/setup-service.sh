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

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "Error: Node.js not found. Please install Node.js first."
    exit 1
fi

# Check if .env file exists
if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo "Warning: .env file not found at $PROJECT_DIR/.env"
    echo "Please create it before starting the service."
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
Environment="PATH=/usr/local/bin:/usr/bin:/bin"
ExecStart=/usr/bin/node $PROJECT_DIR/dist/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Security settings
NoNewPrivileges=true
PrivateTmp=true

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
echo "Useful commands:"
echo "  Start service:     sudo systemctl start $SERVICE_NAME"
echo "  Stop service:      sudo systemctl stop $SERVICE_NAME"
echo "  Restart service:   sudo systemctl restart $SERVICE_NAME"
echo "  Check status:      sudo systemctl status $SERVICE_NAME"
echo "  View logs:         sudo journalctl -u $SERVICE_NAME -f"
echo "  Disable on boot:   sudo systemctl disable $SERVICE_NAME"
echo ""
