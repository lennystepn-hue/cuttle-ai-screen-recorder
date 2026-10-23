#!/bin/sh
# The Docker image's entry: a virtual display for Electron's Chromium, then the cuttle command with
# the container's arguments. Not xvfb-run: as a container's first process it waits for Xvfb forever.
Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp >/dev/null 2>&1 &
export DISPLAY=:99
tries=0
while [ ! -e /tmp/.X11-unix/X99 ] && [ "$tries" -lt 100 ]; do
  sleep 0.1
  tries=$((tries + 1))
done
exec node /cuttle/apps/cli/dist/cuttle.mjs "$@"
