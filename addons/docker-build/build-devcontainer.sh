#!/bin/bash

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"/../.. || exit 1  # Change to checkout directory

eval "$(addons/docker-build/get-build-vars.sh)"

[ -n "${WHBUILD_ASSETROOT:-}" ] || WHBUILD_ASSETROOT="https://build.webhare.dev/whbuild/"

podman build \
  -t localhost/webhare/platform:devcontainer \
  --build-arg WEBHARE_NODE_MAJOR="$WEBHARE_NODE_MAJOR" \
  --build-arg WHBUILD_EMSCRIPTEN_VERSION="$WHBUILD_EMSCRIPTEN_VERSION"  \
  --build-arg WHBUILD_ASSETROOT="$WHBUILD_ASSETROOT" \
  --file addons/docker-build/Dockerfile \
  --target devcontainer \
  .
