## Connect wifi
- trong os mới, pi5 phải tự connect wifi từ trước thì nó mới nhớ, chứ không dùng đuược file boot config wifi nữa:
```bash
nmcli dev wifi connect "SSID" password "PASSWORD"
sudo nmcli connection modify "SSID" connection.autoconnect yes
nmcli connection show --active
```


À cái này làm được khá gọn và khá “pro” luôn 😄. Ý bạn là:

👉 Pi5 sau khi **kết nối mạng thành công**
👉 Nó sẽ **broadcast 1 gói tin trong LAN**
👉 Laptop bạn nghe gói đó → biết IP Pi → khỏi cần cắm màn hình

Chuẩn kiểu auto discovery luôn 👍

Mình sẽ hướng bạn cách ổn định + dễ maintain nhất:
✅ chạy sau khi network ready
✅ broadcast UDP
✅ chạy trong 100s
✅ auto start bằng systemd

---

# 🧩 Ý tưởng tổng thể

Pi sẽ:

1. Lấy IP hiện tại
2. Broadcast UDP packet
3. Gửi lặp lại trong 100 giây

Laptop bạn chỉ cần listen UDP là bắt được.

---

# 🚀 Bước 1: Tạo script broadcast trên Pi

Tạo file:

```bash
sudo nano /usr/local/bin/pi-broadcast.sh
```

---

## 📜 Script mẫu

```bash
#!/bin/bash

DURATION=100
INTERVAL=2
PORT=5005

IP=$(hostname -I | awk '{print $1}')
HOST=$(hostname)

END=$((SECONDS + DURATION))

while [ $SECONDS -lt $END ]; do
    MSG="PI5_DISCOVERY|HOST=$HOST|IP=$IP"
    echo "$MSG" | nc -u -b 255.255.255.255 $PORT
    sleep $INTERVAL
done
```

---

👉 Ý nghĩa:

* broadcast tới `255.255.255.255`
* gửi mỗi 2 giây
* tổng 100 giây
* dùng netcat (nc)

---

# 🧩 Bước 2: Cài netcat nếu chưa có

```bash
sudo apt install netcat-openbsd
```

---

# 🧩 Bước 3: Set quyền chạy

```bash
sudo chmod +x /usr/local/bin/pi-broadcast.sh
```

---

# 🧩 Bước 4: Tạo service auto chạy khi có mạng

```bash
sudo nano /etc/systemd/system/pi-broadcast.service
```

---

## 📜 Nội dung service

```ini
[Unit]
Description=Pi Broadcast IP
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/pi-broadcast.sh
Type=simple

[Install]
WantedBy=multi-user.target
```

---

# 🧩 Bước 5: Enable service

```bash
sudo systemctl daemon-reload
sudo systemctl enable pi-broadcast.service
```

---

# 🧩 Bước 6: Test luôn

```bash
sudo systemctl start pi-broadcast.service
```

---

# 💻 Bên laptop – nghe broadcast

Linux / WSL / mac:

```bash
nc -ul 5005
```

Windows PowerShell (nếu có ncat):

```powershell
ncat -ul 5005
```

---

👉 Khi Pi online bạn sẽ thấy kiểu:

```
PI5_DISCOVERY|HOST=raspberrypi|IP=192.168.1.55
```

---

# 🧠 Nếu bạn muốn làm xịn hơn

Có vài trick hay:

---

## ⭐ Gửi JSON thay vì text

Dễ parse hơn:

```bash
MSG="{\"host\":\"$HOST\",\"ip\":\"$IP\"}"
```

---

## ⭐ Broadcast đúng subnet thay vì 255.255.255.255

Ổn định hơn trên vài router:

```bash
BCAST=$(ip route | grep broadcast | awk '{print $9}')
```

---

## ⭐ Chỉ broadcast khi WiFi connect (không phải ethernet)

Có thể check:

```bash
ip link show wlan0 | grep "state UP"
```

---

## ⭐ Tránh gửi trước khi DHCP xong

Thêm delay:

```bash
sleep 5
```

---

# 🧪 Cách debug nếu không thấy packet

Trên laptop chạy:

```bash
tcpdump -i any udp port 5005
```

---

# 💡 Một giải pháp khác (nhiều người dùng hơn broadcast)

👉 dùng mDNS / zeroconf
Ví dụ bạn truy cập luôn:

```
raspberrypi.local
```

Pi OS thường có sẵn `avahi-daemon`.

Cách này:

* Không cần broadcast script
* Rất phổ biến trong IoT

---

# 👉 Cá nhân mình hỏi thêm chút (để gợi ý kiến trúc ngon hơn)

Laptop bạn cần biết IP Pi để:

* SSH
* Web dashboard
* Automation / monitoring
* Cluster / distributed system
* Hay project IoT discovery

Bạn đang build theo hướng nào? 😄
