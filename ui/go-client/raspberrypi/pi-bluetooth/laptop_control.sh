#!/bin/bash

# ===== CONFIG =====
PI_MAC="2C:CF:67:4A:92:A7"
RFCOMM_DEV="/dev/rfcomm0"

echo "=== Bluetooth WiFi Provision ==="

# ---- Input WiFi ----
read -p "Enter WiFi SSID: " SSID
read -s -p "Enter WiFi Password: " PASSWORD
echo ""

# ---- Connect Bluetooth ----
echo "Connecting to Pi via Bluetooth..."

sudo rfcomm connect 0 $PI_MAC &
RFCOMM_PID=$!

# ---- Wait rfcomm device ----
echo "Waiting for RFCOMM device..."

for i in {1..10}; do
    if [ -e "$RFCOMM_DEV" ]; then
        break
    fi
    sleep 1
done

if [ ! -e "$RFCOMM_DEV" ]; then
    echo "ERROR: RFCOMM device not found"
    kill $RFCOMM_PID 2>/dev/null
    exit 1
fi

echo "Connected!"

# ---- Send JSON ----
JSON="{\"ssid\":\"$SSID\",\"password\":\"$PASSWORD\"}"

echo "Sending WiFi config..."
echo "$JSON" > $RFCOMM_DEV

sleep 1

# ---- Disconnect ----
echo "Disconnecting Bluetooth..."
kill $RFCOMM_PID 2>/dev/null

echo "Done ✅"
