### ✅ Cách sửa lỗi camera **IMX219 bị tím/đỏ trên Raspberry Pi 5**

👉 Nguyên nhân:
Pi5 dùng ISP mới (PiSP). Nếu camera là **IMX219 NoIR** nhưng hệ thống dùng tuning file bản thường → ảnh sẽ tím/xanh/đỏ.

---

### 🔧 Cách sửa nhanh nhất

1️⃣ Kiểm tra camera hoạt động

```
rpicam-hello --list-cameras
```

---

2️⃣ Test bằng tuning NoIR

```
rpicam-still --tuning-file /usr/share/libcamera/ipa/rpi/pisp/imx219_noir.json -o test.jpg
```

Nếu ảnh bình thường → đúng lỗi tuning.

---

3️⃣ Đặt NoIR làm mặc định (khuyến nghị)

```
cd /usr/share/libcamera/ipa/rpi/pisp/
sudo mv imx219.json imx219.json.bak
sudo ln -s imx219_noir.json imx219.json
```

---

4️⃣ Xóa cache camera

```
rm -rf ~/.cache/libcamera
```

---

✅ Sau đó mọi app (WebRTC, libcamera, rpicam…) sẽ dùng màu đúng.

---

Nếu nói gọn 1 câu:

👉 Pi5 + IMX219 NoIR phải dùng `imx219_noir.json` thay vì `imx219.json`.

---

Nếu sau này bạn build streaming/WebRTC bằng Pi5 + IMX219, tuning này gần như bắt buộc để màu không bị sai.

---

## Nếu không có các file json turning trên, thì Pi5 đang ở bản cũ:
```bash
  389  sudo apt update
  390  sudo apt full-upgrade
  392  sudo reboot
  396  sudo apt remove rpicam-apps libcamera-apps
  397  sudo apt autoremove 
  398  sudo apt install rpicam-apps libcamera-apps
  400  sudo reboot
  406  sudo mv /usr/share/libcamera/ipa/rpi/pisp/imx219.json /usr/share/libcamera/ipa/rpi/pisp/imx219.json_bak
  407  sudo ln -s  /usr/share/libcamera/ipa/rpi/pisp/imx219_noir.json /usr/share/libcamera/ipa/rpi/pisp/imx219.json

```
