#!/bin/bash

PI_MAC="2C:CF:67:4A:92:A7"
RFCOMM_DEV="/dev/rfcomm0"

echo "=== Bluetooth WiFi Provision ==="

sudo rfcomm release 0 2>/dev/null

echo "Connecting to Pi via Bluetooth..."

sudo rfcomm connect 0 $PI_MAC &
RFCOMM_PID=$!

# ----- Wait RFCOMM -----
for i in {1..15}; do
    [ -e "$RFCOMM_DEV" ] && break
    sleep 1
done

if [ ! -e "$RFCOMM_DEV" ]; then
    echo "RFCOMM device not found"
    exit 1
fi

# Disable echo (important)
stty -F "$RFCOMM_DEV" -echo

echo "Connected!"

# ----- WIFI INFO -----

echo "Requesting WiFi info..."

# Avoid immediate clear/send
sleep 2

# Clear any pending data
read -t 0.1 -N 1000 DISCARD < "$RFCOMM_DEV" 2>/dev/null

echo '{"action":"wifi_info"}' > "$RFCOMM_DEV"

# Wait for response with retry/loop (since bluetooth can be slow/echo)
MAX_RETRIES=100
FOUND_VALID_JSON=0

for ((i=1; i<=MAX_RETRIES; i++)); do
    if read -t 0.5 LINE < "$RFCOMM_DEV"; then
        # Check if line contains "ssid" or distinct field to avoid echo
        if [[ "$LINE" == *"ssid"* ]]; then
             WIFI_INFO="$LINE"
             FOUND_VALID_JSON=1
             break
        elif [[ "$LINE" == *'"action":"wifi_info"'* ]]; then
             # Likely an echo of our command, ignore
             echo "Ignored echo: $LINE"
             continue
        fi
    fi
    # Small sleep to be nice to CPU
    sleep 0.1
done

if [ $FOUND_VALID_JSON -eq 1 ]; then
    # Try to parse JSON using python3 since jq might not be installed
    echo "Pi response (Raw): $WIFI_INFO"
    
    PARSED=$(echo "$WIFI_INFO" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if data.get('action') == 'wifi_info':
        info = data.get('data', {})
        print(f\"SSID: {info.get('ssid')}\nSignal: {info.get('signal')}\nIP: {info.get('ip')}\")
    else:
        print('Unknown response format')
except Exception as e:
    print(f'Parse error: {e}')
")
    echo "--------------------------"
    echo "$PARSED"
    echo "--------------------------"
else
    echo "Timeout waiting Pi response (or only echo received)"
fi


# ----- ASK USER -----

# Force read from /dev/tty to avoid skipping if script is piped
# Loop until valid input
while true; do
    echo -n "Connect to another WiFi? (y/N): "
    if read -r ANSWER < /dev/tty; then
        if [[ "$ANSWER" =~ ^[Yy]$ ]]; then
            break
        elif [[ "$ANSWER" =~ ^[Nn]$ ]] || [[ -z "$ANSWER" ]]; then
            kill $RFCOMM_PID 2>/dev/null
            echo "Done"
            exit 0
        fi
    else
        # Read failed? (EOF or error)
        echo "Read failed, exiting."
        exit 1
    fi
done


# ----- INPUT WIFI -----

read -r -p "SSID: " SSID
read -s -p "Password: " PASSWORD
echo

JSON="{\"action\":\"connect_wifi\",\"ssid\":\"$SSID\",\"password\":\"$PASSWORD\"}"

echo "$JSON" > "$RFCOMM_DEV"

# ----- Progress wait -----

for i in {1..40}; do
  # Use integer arithmetic: i * 2.5 -> (i * 5) / 2
  printf "\rConnecting WiFi %d%%" "$(( (i * 5) / 2 ))"
  sleep 0.25
done
echo

if read -t 20 RESP < "$RFCOMM_DEV"; then
    echo "Pi response: $RESP"
else
    echo "Timeout waiting connect result"
fi

kill $RFCOMM_PID 2>/dev/null
echo "Done"
