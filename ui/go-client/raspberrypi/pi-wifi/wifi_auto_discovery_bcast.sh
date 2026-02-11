#!/bin/bash
# app này cho phép nó tự gửi gói tin trong 100s sau khi kết nối thành công wifi
# ta có thể phát hiện ra ip của nó để connect
# nhớ cài netcat: sudo apt install netcat-openbsd
# copy to: /usr/local/bin/wifi_auto_discovery_bcast.sh
# đường dẫn service: /etc/systemd/system/pi-broadcast.service

# wait for IP
while [ -z "$(hostname -I)" ]; do
    sleep 1
done

sleep 3   # thêm buffer cho WiFi ổn định

DURATION=100
INTERVAL=2
PORT=5005

IP=$(hostname -I | awk '{print $1}')
HOST=$(hostname)

END=$((SECONDS + DURATION))

while [ $SECONDS -lt $END ]; do
    MSG="PI5_DISCOVERY|HOST=$HOST|IP=$IP"
    echo "$MSG" | /usr/bin/nc -u -b -q0 255.255.255.255 $PORT
    sleep $INTERVAL
done
