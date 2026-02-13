import json
import os
import subprocess
import time

import serial

# copy file wifi_bt.service to /etc/systemd/system/wifi_bt.service
# copy wifi_receiver.py to /home/assmin/
# systemctl enable wifi_bt
# systemctl start wifi_bt

RFCOMM_DEVICE = "/dev/rfcomm0"


def connect_wifi(ssid, password):
  print("Connecting to WiFi:", ssid)

  cmd = [
    "nmcli",
    "dev",
    "wifi",
    "connect",
    ssid,
    "password",
    password
  ]

  subprocess.run(cmd)


def wait_for_rfcomm():
  print("Waiting for Bluetooth connection...")

  while not os.path.exists(RFCOMM_DEVICE):
    time.sleep(2)

  print("RFCOMM device detected!")


def open_serial():
  while True:
    try:
      return serial.Serial(RFCOMM_DEVICE, 9600, timeout=1)
    except Exception as e:
      print("Failed to open serial:", e)
      time.sleep(2)


while True:
  # ---- Wait for device ----
  wait_for_rfcomm()

  # ---- Open serial ----
  ser = open_serial()
  print("Bluetooth client connected!")

  try:
    while True:
      line = ser.readline().decode(errors="ignore").strip()

      if not line:
        continue

      print("Received:", line)

      try:
        data = json.loads(line)

        ssid = data.get("ssid")
        password = data.get("password")

        if ssid and password:
          connect_wifi(ssid, password)
        else:
          print("Invalid JSON format")

      except json.JSONDecodeError:
        print("JSON parse error")

  except Exception as e:
    print("Connection lost:", e)

  finally:
    try:
      ser.close()
    except:
      pass

    print("Waiting for new Bluetooth connection...")
    time.sleep(2)
