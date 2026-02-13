# Pi5 connect wifi via bluetooth command from linux laptop
> https://chatgpt.com/share/698f8a13-bb14-8002-9b72-aa21c06bf34b
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
  - `sudo sdptool add SP`
  - Sau đó: reboot



## 2. In linux laptop

RUN:
`laptop_control.sh`

## 3. Check on pi

```bash
sudo systemctl status bt-auto-enable
sudo systemctl status rfcomm-server
sudo systemctl status wifi_bt
ps aux | grep bluetoothd
ps aux | grep rfcomm
ls /dev/rfcomm0
cd && cat log.log

assmin@raspberrypi:~ $ bluetoothctl show
Controller 2C:CF:67:4A:92:A7 (public)
        Name: raspberrypi
        Alias: raspberrypi
        Class: 0x006c0000
        Powered: yes
        Discoverable: yes
        DiscoverableTimeout: 0x00000000
        Pairable: yes

```
