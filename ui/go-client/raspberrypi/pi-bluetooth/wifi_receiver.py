# copy file wifi_bt.service to /etc/systemd/system/wifi_bt.service
# copy wifi_receiver.py to /home/assmin/
# systemctl enable wifi_bt
# systemctl start wifi_bt

import json
import os
import subprocess
import time

import serial

RFCOMM_DEVICE = "/dev/rfcomm0"
LOG_FILE = "/home/assmin/log.log"
# Clear log
if os.path.exists(LOG_FILE):
  os.remove(LOG_FILE)

def log(msg):
  print(msg)
  with open(LOG_FILE, "a") as f:
    f.write(msg + "\n")

def wait_for_rfcomm():
  print("Waiting for Bluetooth connection...")
  while not os.path.exists(RFCOMM_DEVICE):
    time.sleep(2)
  print("Bluetooth connected!")


def connect_wifi(ssid, password=None):
  print(f"Connecting to WiFi: {ssid}")
  log(f"Connecting to WiFi: {ssid}")

  if not password:
    cmd = ["nmcli", "connection", "up", ssid]
  else:
    cmd = ["nmcli", "dev", "wifi", "connect", ssid, "password", password]

  log(f"Command: {cmd}")
  result = subprocess.run(cmd, capture_output=True, text=True)
  log(f"Result: {result}")
  print(result.stdout)
  print(result.stderr)


while True:

  wait_for_rfcomm()

  try:
    ser = serial.Serial(RFCOMM_DEVICE, 9600, timeout=1)
    buffer = ""

    while True:
      data = ser.read(1024).decode(errors="ignore")

      if not data:
        continue

      buffer += data

      while "\n" in buffer:
        line, buffer = buffer.split("\n", 1)

        if not line:
          continue

        log(f"Received: {line}")

        start = line.find("{")

        if start == -1:
          log("No JSON found")
          continue

        clean_line = line[start:]

        payload = json.loads(clean_line)

        ssid = payload.get("ssid")
        password = payload.get("password")

        connect_wifi(ssid, password)

  except Exception as e:
    print("Bluetooth disconnected:", e)

    try:
      ser.close()
    except:
      pass

    time.sleep(2)
