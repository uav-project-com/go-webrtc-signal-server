#!/usr/bin/python3

import dbus
import dbus.service
import dbus.mainloop.glib
from gi.repository import GLib

BUS_NAME = 'org.bluez'
AGENT_INTERFACE = 'org.bluez.Agent1'
AGENT_PATH = '/test/agent'

class Agent(dbus.service.Object):
    @dbus.service.method(AGENT_INTERFACE, in_signature="os", out_signature="")
    def DisplayOnly(self, device, pin):
        print(f"DisplayOnly({device}, {pin})")

    @dbus.service.method(AGENT_INTERFACE, in_signature="os", out_signature="")
    def AuthorizeService(self, device, uuid):
        print(f"AuthorizeService({device}, {uuid})")
        return

    @dbus.service.method(AGENT_INTERFACE, in_signature="o", out_signature="s")
    def RequestPinCode(self, device):
        print(f"RequestPinCode({device})")
        return "0000"

    @dbus.service.method(AGENT_INTERFACE, in_signature="o", out_signature="u")
    def RequestPasskey(self, device):
        print(f"RequestPasskey({device})")
        return dbus.UInt32(000000)

    @dbus.service.method(AGENT_INTERFACE, in_signature="ouq", out_signature="")
    def DisplayPasskey(self, device, passkey, entered):
        print(f"DisplayPasskey({device}, {passkey:06d} entered {entered})")

    @dbus.service.method(AGENT_INTERFACE, in_signature="os", out_signature="")
    def DisplayPinCode(self, device, pincode):
        print(f"DisplayPinCode({device}, {pincode})")

    @dbus.service.method(AGENT_INTERFACE, in_signature="ou", out_signature="")
    def RequestConfirmation(self, device, passkey):
        print(f"RequestConfirmation({device}, {passkey:06d})")
        return

    @dbus.service.method(AGENT_INTERFACE, in_signature="o", out_signature="")
    def RequestAuthorization(self, device):
        print(f"RequestAuthorization({device})")
        return

    @dbus.service.method(AGENT_INTERFACE, in_signature="", out_signature="")
    def Cancel(self):
        print("Cancel")

class Profile(dbus.service.Object):
    fd = -1

    @dbus.service.method("org.bluez.Profile1",
                         in_signature="", out_signature="")
    def Release(self):
        print("Release")

    @dbus.service.method("org.bluez.Profile1",
                         in_signature="oha{sv}", out_signature="")
    def NewConnection(self, path, fd, properties):
        self.fd = fd.take()
        print(f"NewConnection({path}, {self.fd})")
        # In a real app we'd attach this to a socket,
        # but wifi_receiver.py is doing the actual listening socket.
        # So we just close the DBus one to prevent conflicts.
        import os
        os.close(self.fd)

    @dbus.service.method("org.bluez.Profile1",
                         in_signature="o", out_signature="")
    def RequestDisconnection(self, path):
        print(f"RequestDisconnection({path})")

import subprocess

def main():
    # Attempt to remove the laptop's pairing from Pi memory to force fresh pairing every time
    print("Clearing laptop MAC from bluetooth memory...")
    subprocess.run(["bluetoothctl", "remove", "5C:5F:67:8A:48:BD"], capture_output=True)

    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SystemBus()

    agent = Agent(bus, AGENT_PATH)

    obj = bus.get_object(BUS_NAME, "/org/bluez")
    manager = dbus.Interface(obj, "org.bluez.AgentManager1")
    manager.RegisterAgent(AGENT_PATH, "NoInputNoOutput")
    manager.RequestDefaultAgent(AGENT_PATH)
    print("Agent registered")

    # Register SPP Profile
    profile_path = "/test/profile"
    profile = Profile(bus, profile_path)
    opts = {
        "Name": "Serial Port",
        "ServiceRecord": """
        <?xml version="1.0" encoding="UTF-8" ?>
        <record>
          <attribute id="0x0001">
            <sequence>
              <uuid value="0x1101"/>
            </sequence>
          </attribute>
          <attribute id="0x0004">
            <sequence>
              <sequence>
                <uuid value="0x0100"/>
              </sequence>
              <sequence>
                <uuid value="0x0003"/>
                <uint8 value="2" name="channel"/>
              </sequence>
            </sequence>
          </attribute>
          <attribute id="0x0100">
            <text value="Serial Port" name="name"/>
          </attribute>
        </record>
        """,
        "Role": "server",
        "RequireAuthentication": False,
        "RequireAuthorization": False
    }

    profile_manager = dbus.Interface(obj, "org.bluez.ProfileManager1")
    profile_manager.RegisterProfile(profile_path, "1101", opts)
    print("SPP Profile registered")

    mainloop = GLib.MainLoop()
    mainloop.run()

if __name__ == '__main__':
    main()
