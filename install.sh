#!/usr/bin/env bash
# Sets up LB-M8 Settings on Linux:
#   1. a udev rule so your browser may talk to the mouse (needs sudo once)
#   2. an "LB-M8 Settings" entry in your app menu that opens the app in its own window
# Usage: ./install.sh            install or update
#        ./install.sh --remove   undo both steps
# Pick the browser yourself with LBM8_BROWSER=chromium ./install.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
rules=/etc/udev/rules.d/70-lingbao-lbm8.rules
apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
launcher="$apps/lb-m8-settings.desktop"

refresh_menu() {
  command -v update-desktop-database >/dev/null && update-desktop-database "$apps" 2>/dev/null || true
  command -v kbuildsycoca6 >/dev/null && kbuildsycoca6 >/dev/null 2>&1 || true
}

if [[ "${1:-}" == "--remove" ]]; then
  rm -f "$launcher" && refresh_menu && echo "Removed the app menu entry."
  if [[ -e "$rules" ]]; then
    sudo rm -f "$rules" && sudo udevadm control --reload-rules && echo "Removed $rules."
  fi
  exit 0
fi

echo "1/2  Device permissions"
if cmp -s "$here/linux/70-lingbao-lbm8.rules" "$rules"; then
  echo "     Already installed."
else
  sudo install -m644 "$here/linux/70-lingbao-lbm8.rules" "$rules"
  sudo udevadm control --reload-rules
  sudo udevadm trigger --action=add --subsystem-match=hidraw
  echo "     Installed $rules. Unplug and replug the mouse or receiver if the app can't see it."
fi

echo "2/2  App menu entry"
browser="${LBM8_BROWSER:-}"
if [[ -z "$browser" ]]; then
  for b in google-chrome-stable google-chrome chromium chromium-browser brave-browser brave microsoft-edge-stable brave-origin-nightly; do
    if command -v "$b" >/dev/null; then browser="$b"; break; fi
  done
fi
if [[ -z "$browser" ]]; then
  echo "     No Chromium-based browser found. Install Chrome, Edge, Brave or Chromium, then run this again." >&2
  exit 1
fi

mkdir -p "$apps"
url="file://${here// /%%20}/index.html"  # spaces become %20; desktop files need % written as %%
cat > "$launcher" <<EOF
[Desktop Entry]
Type=Application
Name=LB-M8 Settings
GenericName=Mouse Settings
Comment=DPI, polling rate and sensor settings for the Lingbao M8 mouse
Exec=$browser --app=$url
Icon=$here/icon.svg
Terminal=false
Categories=Settings;HardwareSettings;
Keywords=mouse;dpi;lingbao;m8;polling;
EOF
refresh_menu
echo "     Added \"LB-M8 Settings\" to your app menu (opens with $browser)."
