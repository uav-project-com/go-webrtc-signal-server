import json
import socket
import subprocess
import sys
import time


# LOG_FILE = "/home/assmin/log.log"
# Use stdout so it shows up in journalctl (systemctl status wifi_bt)
def log(msg):
    print(msg)
    sys.stdout.flush()

# -------- WIFI CONNECT --------
def connect_wifi(ssid, password=None):
    if not ssid:
        return False
    if password:
        cmd = ["nmcli", "dev", "wifi", "connect", ssid, "password", password]
    else:
        cmd = ["nmcli", "connection", "up", ssid]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        log(f"Connect result: {res.stdout} {res.stderr}")
        return res.returncode == 0
    except Exception as e:
        log(f"WiFi error: {e}")
        return False

# -------- WIFI INFO --------
def get_wifi_info():
    info = {"ssid": "Unknown", "ip": "Unknown", "signal": "0"}
    try:
        # Get active connection details
        res = subprocess.run(
            ["nmcli", "-t", "-f", "ACTIVE,SSID,SIGNAL", "dev", "wifi"],
            capture_output=True,
            text=True
        )
        for line in res.stdout.splitlines():
            parts = line.split(":")
            if len(parts) >= 3 and parts[0] == "yes":
                info["signal"] = parts[-1]
                info["ssid"] = ":".join(parts[1:-1])
                break

        # Fallback to connection show
        if info["ssid"] == "Unknown":
            res_conn = subprocess.run(["nmcli", "-t", "-f", "NAME", "connection", "show", "--active"], capture_output=True, text=True)
            if res_conn.returncode == 0 and res_conn.stdout.strip():
                info["ssid"] = res_conn.stdout.strip().split('\n')[0]

        # Get IP
        res = subprocess.run(["hostname", "-I"], capture_output=True, text=True)
        ips = res.stdout.strip().split()
        if ips:
            info["ip"] = ips[0]

    except Exception as e:
        log(f"wifi info error: {e}")
    return info

# -------- SEND RESPONSE --------
def send_response(sock, payload):
    try:
        msg = json.dumps(payload) + "\n"
        sock.send(msg.encode())
        log("Sent: " + msg.strip())
    except Exception as e:
        log(f"Send error: {e}")

# ================= MAIN SEVER LOOP =================
def run_server():
    log("Starting Bluetooth WiFi Receiver (Socket Mode)...")

    # Enable Discoverability (optional but good practice)
    subprocess.run(["hciconfig", "hci0", "piscan"])

    server_sock = socket.socket(socket.AF_BLUETOOTH, socket.SOCK_STREAM, socket.BTPROTO_RFCOMM)

    # Try to bind to "any" address first
    try:
        log("Binding to 00:00:00:00:00:00 port 1...")
        server_sock.bind(("00:00:00:00:00:00", 1)) # BDADDR_ANY
    except Exception as e:
        log(f"Bind to ANY failed: {e}. Trying to find hci0 address...")
        try:
            # Fallback: Find exact MAC of hci0
            res = subprocess.run(["hcitool", "dev"], capture_output=True, text=True)
            # Output format:
            # Devices:
            # 	hci0	DC:A6:32:04:81:60
            mac = None
            for line in res.stdout.splitlines():
                if "hci0" in line:
                    parts = line.split()
                    if len(parts) >= 2:
                        mac = parts[1]
                        break

            if mac:
                log(f"Binding to {mac} port 1...")
                server_sock.bind((mac, 1))
            else:
                log("Could not find hci0 MAC address.")
                raise e
        except Exception as inner_e:
            log(f"Bind failed completely: {inner_e}")
            raise inner_e

    server_sock.listen(1)

    while True:
        log("Waiting for incoming connection on RFCOMM channel 1...")
        try:
            client_sock, address = server_sock.accept()
            log(f"Accepted connection from {address}")

            client_sock.settimeout(None) # Blocking mode or use timeout loop
            buffer = ""

            while True:
                try:
                    data = client_sock.recv(1024)
                    if not data:
                        break # EOF

                    buffer += data.decode("utf-8", errors="ignore")

                    while "\n" in buffer:
                        line, buffer = buffer.split("\n", 1)
                        line = line.strip()
                        if not line: continue

                        log("Received: " + line)
                        try:
                            payload = json.loads(line)
                            action = payload.get("action")

                            if action == "wifi_info":
                                send_response(client_sock, {
                                    "action": "wifi_info",
                                    "data": get_wifi_info()
                                })
                            elif action == "connect_wifi":
                                ok = connect_wifi(payload.get("ssid"), payload.get("password"))
                                send_response(client_sock, {
                                    "action": "connect_wifi",
                                    "success": ok
                                })
                            else:
                                send_response(client_sock, {"error": "unknown_action"})
                        except json.JSONDecodeError:
                            log("Invalid JSON received")

                except OSError as e:
                    log(f"Connection lost: {e}")
                    break

            client_sock.close()
            log("Client disconnected")

        except Exception as e:
            log(f"Server error: {e}")
            time.sleep(1)

if __name__ == "__main__":
    run_server()
