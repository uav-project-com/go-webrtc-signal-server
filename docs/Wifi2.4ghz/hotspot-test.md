# Test FPV video streaming via wifi hotspot card

```bash
# Tao hotspot:
nmcli dev wifi hotspot \
  ifname wlp2s0 \
  ssid FPV_GROUND \
  password canhthong

# enable ip forward (once)
echo "net.ipv4.ip_forward=1" | sudo tee -a /etc/sysctl.conf


# xem ip android, ex: export IP_ANDROID=10.42.0.191

# forward raw udp to 5600 port
socat -u UDP-RECV:5600 UDP-SENDTO:$IP_ANDROID:5600

# Test send video
# ffmpeg -re -i /home/hieutt/Videos/test.mp4 \
#   -c:v copy \
#   -f mpegts \
#   udp://$IP_ANDROID:5600

ffmpeg -re -i /home/hieutt/Videos/test.mp4 \
  -c:v libx264 \
  -preset ultrafast \
  -tune zerolatency \
  -f mpegts \
  udp://$IP_ANDROID:5600

nmcli connection show --active
# Tat hotspot
nmcli connection down Hotspot
```
## Android mở VLC:
- app > more > New stream
> udp://@:5600