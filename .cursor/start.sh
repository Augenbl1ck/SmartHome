#!/usr/bin/env bash
#
# Per-boot startup for the SmartHome Cloud Agent environment.
# Brings up the Mosquitto MQTT broker that every backend service depends on,
# then returns. Long-running dev servers run as tmux terminals instead.
#
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

if port_open 1883; then
  echo "Mosquitto already running on port 1883."
else
  echo "Starting Mosquitto MQTT broker..."
  mosquitto -c "$DIR/mosquitto.conf" -d
  for _ in $(seq 1 20); do
    if port_open 1883; then
      echo "Mosquitto ready on port 1883."
      break
    fi
    sleep 0.5
  done
  if ! port_open 1883; then
    echo "ERROR: Mosquitto did not become ready on port 1883." >&2
    exit 1
  fi
fi
