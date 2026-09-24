#!/bin/bash

WEBHARE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/../.. || exit 1; pwd)/whtree"
WEBHARE_NODE_MAJOR="$(grep ^node_major= "$WEBHARE_DIR/etc/platform.conf" | cut -d= -f2)"
[ -n "$WEBHARE_NODE_MAJOR" ] || { echo "Could not set WEBHARE_NODE_MAJOR from $WEBHARE_DIR/etc/platform.conf" >&2; exit 1; }

WHBUILD_EMSCRIPTEN_VERSION="$(grep ^emscripten= "$WEBHARE_DIR/etc/platform.conf" | cut -d= -f2)"
[ -n "$WHBUILD_EMSCRIPTEN_VERSION" ] || { echo "Could not set WHBUILD_EMSCRIPTEN_VERSION from $WEBHARE_DIR/etc/platform.conf" >&2; exit 1; }

for var in WEBHARE_NODE_MAJOR WHBUILD_EMSCRIPTEN_VERSION ; do
  echo "$var=${!var}"
done
