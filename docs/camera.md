# Workshop camera on the Pi

- `x2d-camera-failover` (this repo, `deploy/x2d-camera-failover.py`) answers on **:8091** with `/x2d/frame.jpg` and `/x2d/health.json`.
  It serves the Pi's own bridge first and the MacBook's (`10.0.0.82:8091`) when the Pi has no frame under 5 s old.
- The Pi's own bridge is `x2d-camera-bridge`, installed by `bambuhelper-smart-display/tools/install_x2d_bridge_pi.sh`.
  Pi Hub moves it to **127.0.0.1:8092** with a drop-in at `/etc/systemd/system/x2d-camera-bridge.service.d/port.conf`.
  Re-running that install script rewrites the main unit, but the drop-in is a separate file and survives. `deploy/install.sh` reinstalls it as well.
- The Pi bridge needs "LAN Only Liveview" on at the printer, and the access code set with `install_x2d_bridge_pi.sh --set-code`.
- The WS350 firmware's camera URL is built in at compile time. The display's own builds use `X2D_BRIDGE_URL=http://10.0.0.80:8091/x2d/frame.jpg`
  (agreed with the display session on 20 Oct 2026); Pi Hub doesn't install display firmware.


## Verification status

The addresses above describe the configured topology, last documented on 20 October 2026. Camera operation with the Mac asleep still needs live acceptance verification; see [current status](status.md). The release process reinstalls the Pi bridge drop-in when the bridge unit exists, restarts that bridge, and includes the drop-in in failure recovery. See [operations](operations.md) for deployment and rollback.
