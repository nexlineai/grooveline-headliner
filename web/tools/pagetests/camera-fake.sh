#!/bin/sh
# Chromium WITH a camera for the page tests (tools/shot.ts --chromium this file): the fake device shows a moving test picture and
# the camera is allowed without a dialog, so a headless run can start the preview and check the tracks. Never a real camera:
# a test must not open the DJ's hardware, and Zé may be on air.
exec chromium "$@" --use-fake-device-for-media-stream --use-fake-ui-for-media-stream
