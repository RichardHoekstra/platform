#!/bin/bash

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1

podman run \
  --rm \
  --privileged \
  -ti \
  -v "$(pwd)/../..":/opt/wh \
  localhost/webhare/platform:devcontainer
