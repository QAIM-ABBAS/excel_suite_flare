#!/bin/bash
# Watchdog script for the FastAPI server
# Restarts the server whenever it dies

LOGFILE=/home/z/my-project/mini-services/api-service/server.log
PIDFILE=/home/z/my-project/mini-services/api-service/server.pid

while true; do
    if [ -f "$PIDFILE" ]; then
        OLD_PID=$(cat "$PIDFILE")
        if kill -0 "$OLD_PID" 2>/dev/null; then
            sleep 2
            continue
        fi
    fi
    
    echo "[$(date)] Starting FastAPI server..." >> "$LOGFILE"
    python3 -u /home/z/my-project/mini-services/api-service/main.py >> "$LOGFILE" 2>&1 &
    NEW_PID=$!
    echo "$NEW_PID" > "$PIDFILE"
    echo "[$(date)] Started with PID $NEW_PID" >> "$LOGFILE"
    
    # Wait for the process to exit
    wait "$NEW_PID" 2>/dev/null
    EXIT_CODE=$?
    echo "[$(date)] Server exited with code $EXIT_CODE, restarting in 1s..." >> "$LOGFILE"
    sleep 1
done
