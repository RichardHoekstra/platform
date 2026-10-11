#!/bin/bash

set -euo pipefail

if [[ -z "${WHBUILD_SRCDIR:-}" ]]; then
  echo "WHBUILD_SRCDIR not set. Invoke us through wh make!"
  exit 1
fi

if [[ $# -ne 1 || -z "$1" ]]; then
  echo "Usage: $0 TARGETDIR"
  exit 1
fi

SRCDIR=$(cd "$WHBUILD_SRCDIR" && pwd)
NJS_DIR="$SRCDIR/vendor/njs"
TARGETDIR="$1"

if [[ ! -f "$NJS_DIR/nginx/config" ]]; then
  echo "njs submodule not found at $NJS_DIR"
  exit 1
fi

if ! command -v nginx >/dev/null 2>&1; then
  echo "nginx not found in PATH"
  exit 1
fi

mkdir -p "$TARGETDIR"
TARGETDIR=$(cd "$TARGETDIR" && pwd)
NGINX_VERSION=$(nginx -v 2>&1 | sed -E 's#.*nginx/([^[:space:]]+).*#\1#')
if [[ ! "$NGINX_VERSION" =~ ^[0-9]+(\.[0-9]+)+$ ]]; then
  echo "Could not determine NGINX version from: $NGINX_VERSION"
  exit 1
fi

# The nginx module links against libraries produced by the njs build.
(cd "$NJS_DIR" && ./configure && make)

BUILD_DIR=$(mktemp -d "$TARGETDIR/nginx-build.XXXXXX")
trap 'rm -rf "$BUILD_DIR"' EXIT
ARCHIVE="$BUILD_DIR/nginx-$NGINX_VERSION.tar.gz"
SOURCE_DIR="$BUILD_DIR/nginx-$NGINX_VERSION"

curl --fail --location --silent --show-error \
  --output "$ARCHIVE" \
  "https://nginx.org/download/nginx-$NGINX_VERSION.tar.gz"
tar -xzf "$ARCHIVE" -C "$BUILD_DIR"

cd "$SOURCE_DIR"
CONFIGURE_ARGS=(--with-compat --add-dynamic-module="$NJS_DIR/nginx")
QUICKJS_PREFIX="${QUICKJS_PREFIX:-}"
if [[ -z "$QUICKJS_PREFIX" ]] && command -v brew >/dev/null 2>&1; then
  QUICKJS_PREFIX=$(brew --prefix quickjs)
fi
if [[ -n "$QUICKJS_PREFIX" ]]; then
  CONFIGURE_ARGS+=(--with-cc-opt="-I$QUICKJS_PREFIX/include/quickjs" --with-ld-opt="-L$QUICKJS_PREFIX/lib/quickjs")
fi

NJS_QUICKJS=YES ./configure "${CONFIGURE_ARGS[@]}"
if ! grep -Eq '^#define NJS_HAVE_QUICKJS[[:space:]]+1' objs/ngx_auto_config.h; then
  echo "NGINX JavaScript module was configured without QuickJS support"
  exit 1
fi
make modules

cp objs/ngx_http_js_module.so "$TARGETDIR/ngx_http_js_module.so"
echo "Built $TARGETDIR/ngx_http_js_module.so for NGINX $NGINX_VERSION"