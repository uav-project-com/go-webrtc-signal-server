#!/bin/bash
# sudo apt install netcat-openbsd
nc -ul 5005
# scan port:
nmap -p 22 192.168.1.1-128
nmcli connection show --active
