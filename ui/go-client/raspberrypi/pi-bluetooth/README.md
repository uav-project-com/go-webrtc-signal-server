# Pi5 connect wifi via bluetooth command from linux laptop

## 1. In Raspberry Pi5:
- copy file wifi_bt.service to `/etc/systemd/system/wifi_bt.service`
- copy wifi_receiver.py to `/home/assmin/`
- `systemctl enable wifi_bt`
- `systemctl start wifi_bt`

- format message lên dùng:
```json
{
 "ssid":"abc",
 "password":"xyz",
 "country":"VN"
}
```
- sau đo set: `sudo raspi-config nonint do_wifi_country VN`

- `sudo vi /etc/bluetooth/main.conf`
  - Tìm và sửa các dòng sau:
```conf
DiscoverableTimeout = 900
PairableTimeout = 900
```
  - thêm `bt-auto-enable.service` và enable nó
  - Sau đó: reboot


## 2. In linux laptop

RUN:
`laptop_control.sh`
