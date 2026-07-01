#!/bin/bash
cd /home/z/my-project/mini-services/api-service
while true; do
    python3 main.py
    echo "Server crashed, restarting in 2s..." >&2
    sleep 2
done
