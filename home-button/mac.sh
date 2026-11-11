#!/bin/bash
# Glass Home — Home button helper for Fire TV (Mac)
#
# Fire TV only lets a computer give Glass Home the Home button, once. This does it:
#   1. gets Android's adb tool from Google if this Mac doesn't have it (into ~/Library/Application Support/GlassHome)
#   2. finds the TVs with Glass Home on this Wi-Fi
#   3. connects (the TV asks to allow this computer: choose Always allow → OK)
#   4. turns on Glass Home's Home-button service and lets it switch itself back on if Fire TV stops it
# Nothing else on the TV is changed. Afterwards ADB debugging can be turned off again.
#
# Run it: double-click (Terminal opens), or in Terminal:  bash <(curl -fsSL <page>/home-button/mac.sh)
# Options: an address skips the search (… 192.168.1.40); GLASS_ADB=/path/to/adb uses that adb.

PKG=com.bavahar.glass
ME="$PKG/$PKG.HomeWatcher"
DIR="${GLASS_DIR:-$HOME/Library/Application Support/GlassHome}"
ADB="${GLASS_ADB:-}"

line() { printf '\n%s\n' "$*"; }
done_() { echo; [ -t 0 ] && read -r -p "Press Return to close this window. " _; exit "${1:-0}"; }
ask() { local a; read -r -p "$1" a </dev/tty; echo "$a"; }

clear 2>/dev/null
echo "Glass Home — Home button helper (Fire TV)"
echo "========================================="

# ------------------------------------------------------------------ 1. adb
if [ -z "$ADB" ]; then
  if command -v adb >/dev/null 2>&1; then ADB=$(command -v adb)
  else
    ADB="$DIR/platform-tools/adb"
    if [ ! -x "$ADB" ]; then
      line "Getting Android's adb tool from Google (about 10 MB, once)…"
      mkdir -p "$DIR"
      TMP=$(mktemp -d)
      if ! curl -fL --progress-bar -o "$TMP/pt.zip" https://dl.google.com/android/repository/platform-tools-latest-darwin.zip; then
        line "Couldn't download it. Check the internet connection and try again."; done_ 1
      fi
      unzip -q -o "$TMP/pt.zip" -d "$DIR" && rm -rf "$TMP"
      [ -x "$ADB" ] || { line "The download didn't contain adb. Try again later."; done_ 1; }
    fi
  fi
fi
a() { "$ADB" -s "$TV:5555" "$@"; }
tv() { "$ADB" -s "$TV:5555" shell "$@" 2>/dev/null | tr -d '\r'; }

# ------------------------------------------------------------------ 2. which TV
TV="${1:-}"; FOUND=""
if [ -z "$TV" ]; then
  MYIP=""
  for ifc in en0 en1 en2 en3 en4 en5; do MYIP=$(ipconfig getifaddr $ifc 2>/dev/null) && [ -n "$MYIP" ] && break; done
  if [ -n "$MYIP" ]; then
    NET=${MYIP%.*}
    line "Looking for Glass Home on this Wi-Fi ($NET.x)…"
    LIST=$(mktemp)
    for i in $(seq 1 254); do
      ( r=$(curl -s -m 2 "http://$NET.$i:8766/ping" 2>/dev/null)
        case "$r" in *glasshome*)
          n=$(echo "$r" | sed -n 's/.*"name":"\([^"]*\)".*/\1/p'); k=$(echo "$r" | sed -n 's/.*"kind":"\([^"]*\)".*/\1/p')
          echo "$NET.$i|${n:-TV}|$k" >> "$LIST" ;;
        esac ) &
    done
    wait
    FOUND=$(sort -t. -k4 -n "$LIST"); rm -f "$LIST"
  fi
  COUNT=$(printf '%s' "$FOUND" | grep -c . )
  if [ "$COUNT" -eq 1 ]; then
    TV=${FOUND%%|*}; rest=${FOUND#*|}
    echo "Found: ${rest%%|*} at $TV"
  elif [ "$COUNT" -gt 1 ]; then
    echo "Found these TVs with Glass Home:"
    i=0; while IFS='|' read -r ip n k; do i=$((i + 1)); echo "  $i. $n ($ip)"; done <<< "$FOUND"
    pick=$(ask "Which one? Type its number and press Return: ")
    TV=$(echo "$FOUND" | sed -n "${pick}p" | cut -d'|' -f1)
  fi
  if [ -z "$TV" ]; then
    line "No TV with Glass Home answered. Is Glass Home open on the TV, and is this Mac on the same Wi-Fi?"
    echo "You can also type the TV's address. On the Fire TV: Settings → My Fire TV → About → Network → IP Address"
    TV=$(ask "TV address (e.g. 192.168.1.40): ")
    [ -n "$TV" ] || done_ 1
  fi
fi
TV=${TV%:5555}

# ------------------------------------------------------------------ 3. connect
line "Connecting to $TV…"
tries=0
while :; do
  out=$("$ADB" connect "$TV:5555" 2>&1)
  state=$("$ADB" -s "$TV:5555" get-state 2>&1)
  case "$state" in
    device) echo "Connected."; break ;;
  esac
  case "$out$state" in
    *unauthorized*|*authenticate*)
      if [ $tries -eq 0 ]; then
        line "On the TV: a box asks to allow this computer."
        echo "  Choose  Always allow from this computer,  then  OK."
        echo "  Waiting for you (up to 2 minutes)…"
      fi
      sleep 3; tries=$((tries + 1))
      [ $tries -gt 40 ] && { line "The TV didn't allow this computer. Run this again and press OK on the TV's box."; done_ 1; } ;;
    *refused*|*"failed to connect"*|*"No route"*|*"timed out"*|*"cannot connect"*)
      line "The TV didn't answer. On the Fire TV:"
      echo "  Settings → My Fire TV → Developer options → ADB debugging → On"
      echo "  (No Developer options? Settings → My Fire TV → About → press OK on the TV's name 7 times, then go back.)"
      echo "  Also check the address: Settings → My Fire TV → About → Network."
      again=$(ask "Press Return to try again (or type q to stop): ")
      [ "$again" = "q" ] && done_ 1
      "$ADB" disconnect "$TV:5555" >/dev/null 2>&1 ;;
    *)
      sleep 2; tries=$((tries + 1))
      [ $tries -gt 40 ] && { line "Couldn't connect: $out $state"; done_ 1; } ;;
  esac
done

# ------------------------------------------------------------------ 4. the Home button
if ! tv pm path $PKG | grep -q package:; then
  line "Glass Home isn't installed on this TV. Install it first (see the download page), then run this again."
  done_ 1
fi

line "Giving Glass Home the Home button…"
cur=$(tv settings get secure enabled_accessibility_services)
case "$cur" in
  *HomeWatcher*) new="$cur" ;;                         # already on
  ""|null) new="$ME" ;;
  *) new="$cur:$ME" ;;                                 # keep anything else that's on (e.g. VoiceView)
esac
[ "$new" != "$cur" ] && tv "settings put secure enabled_accessibility_services '$new'" >/dev/null
tv settings put secure accessibility_enabled 1 >/dev/null
tv pm grant $PKG android.permission.WRITE_SECURE_SETTINGS >/dev/null      # lets it switch itself back on after Fire TV stops it
tv cmd notification allow_listener $PKG/$PKG.MediaListener >/dev/null      # Now Playing on the home screen
tv appops set $PKG GET_USAGE_STATS allow >/dev/null                         # recently used apps first in the app row
sleep 3

ok=1
tv settings get secure enabled_accessibility_services | grep -q HomeWatcher || ok=0
tv dumpsys package $PKG | grep -q "WRITE_SECURE_SETTINGS: granted=true" || ok=0
"$ADB" disconnect "$TV:5555" >/dev/null 2>&1
"$ADB" kill-server >/dev/null 2>&1

if [ $ok -eq 1 ]; then
  line "✓ Done. The Home button now opens Glass Home — press Home on the remote to try it."
  echo "  It also turns on ≡ ≡ (screen off, sound on) and ≡ ≡ ≡ (video in a widget)."
  echo
  echo "  You can turn ADB debugging off again now (Settings → My Fire TV → Developer options);"
  echo "  Glass Home keeps the Home button."
  done_ 0
else
  line "✗ Something didn't take. Run this again; if it still fails, send the text above with your feedback."
  done_ 1
fi
