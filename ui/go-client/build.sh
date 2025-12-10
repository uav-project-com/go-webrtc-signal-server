#!/bin/bash
echo Should build on linux

CGO_ENABLED=1 go build -o uav main.go
