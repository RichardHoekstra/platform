#!/bin/bash
# shellcheck disable=SC2329 # shellcheck thinks getwebhareversion is never invoked, but its invoked indirectly
# wh runtest system.test-wh-functions
source "${WEBHARE_DIR}/lib/wh-functions.sh"

function testToFsPath() {
  testEq "$WEBHARE_DIR/modules/system/lib" "$(wh tofspath mod::system/lib)"
  testEq "$WEBHARE_DIR/modules/system/" "$(wh tofspath mod::system/)"
  testEq "$WEBHARE_DIR/modules/system/" "$(wh tofspath mod::system)"
  testEq "$WEBHARE_DIR/modules/system/ a b" "$(wh tofspath "mod::system/ a b")"
  testEq "${WEBHARE_DATAROOT}storage/system/" "$(wh tofspath "storage::system")"
  testEq "${WEBHARE_DATAROOT}storage/system/" "$(wh tofspath "storage::system/")"
  testEq "${WEBHARE_DATAROOT}storage/system/test/1" "$(wh tofspath "storage::system/test/1")"
  testEq "${WEBHARE_DATAROOT}storage/system/ a b" "$(wh tofspath "storage::system/ a b")"
  testEq "${WEBHARE_DATAROOT}storage/system/ a b" "$(wh tofspath "storage::system/ a b")"
  testEq "${WEBHARE_DATAROOT}storage/system/test/1 a b" "$(wh tofspath "storage::system/test/1 a b")"
}

expectWasmEngine()
{
  local STATUS=false

  echo -n "is_wasmengine(\"$2\"): "
  is_wasmengine "$2" && STATUS=true

  if [ "$STATUS" != "$1" ]; then
    echo "${STATUS} (FAIL, expected $1)"
    [ "$3" != "" ] && echo "$3"
    exit 1
  fi
  echo "${STATUS} (OK)"
}
testIsWasmEngine()
{
  expectWasmEngine true  "<?wh (*WASMENGINE*)"
  expectWasmEngine false "<?wh *WASMENGINE*)"
}

testContainerTagCalculation()
{
  CI_REGISTRY_IMAGE=ghcr.io/webhare/platform
  DOCKERHUB_REGISTRY_USER=exampleuser
  DOCKERHUB_REGISTRY_PASSWORD=topsecret
  PUBLIC_REGISTRY_IMAGE=docker.io/webhare/platform
  CI_COMMIT_SHA=test
  CI_COMMIT_TAG=

  exists_origin_branch() { # mock branch check as we can't do a 'ls-remote' inside the test CI container
    if [ "$1" == "release/5.6" ]; then
      return 0 #tell that release/5.6 exists
    fi
    if [ "$1" == "release/5.99" ]; then
      return 1
    fi
    echo "unexpected branch request for $1 - formatting error in branch name?" >&2
    exit 1
  }

  getwebhareversion() # mock version getter
  {
    export WEBHARE_VERSION=5.6.7
  }

  CI_COMMIT_REF_NAME=main
  CI_COMMIT_REF_SLUG=main

  # building 'main' when our release/x-y branch exists should just build 'main'
  echo ---- CI_COMMIT_REF_NAME=$CI_COMMIT_REF_NAME CI_COMMIT_REF_SLUG=$CI_COMMIT_REF_SLUG with WEBHARE_VERSION=5.6.7
  get_finaltag
  list_finaltag
  testEq "ghcr.io/webhare/platform:main" "$BRANCH_IMAGES"
  testEq "docker.io/webhare/platform:main" "$PUBLIC_IMAGES"
  testEq "5.6.7" "$WEBHARE_VERSION"

  getwebhareversion() # mock version getter
  {
    export WEBHARE_VERSION=5.99.0 #nonexisting version
  }

  # building 'main' should also tag release branches so users can 'target' those for their dockers unless the release branch already exists
  echo ---- CI_COMMIT_REF_NAME=$CI_COMMIT_REF_NAME CI_COMMIT_REF_SLUG=$CI_COMMIT_REF_SLUG with WEBHARE_VERSION=5.99.0
  get_finaltag
  list_finaltag
  testEq "ghcr.io/webhare/platform:main" "$BRANCH_IMAGES"
  testEq "docker.io/webhare/platform:main docker.io/webhare/platform:release-5-99 ghcr.io/webhare/platform:release-5-99 docker.io/webhare/platform:5.99.0 ghcr.io/webhare/platform:5.99.0" "$PUBLIC_IMAGES"
  testEq "5.99.0" "$WEBHARE_VERSION"

  getwebhareversion() # mock version getter
  {
    export WEBHARE_VERSION=4.35.0
  }

  CI_COMMIT_REF_NAME=release/4.35
  CI_COMMIT_REF_SLUG=release-4-35

  echo ---- CI_COMMIT_REF_NAME=$CI_COMMIT_REF_NAME CI_COMMIT_REF_SLUG=$CI_COMMIT_REF_SLUG
  get_finaltag
  list_finaltag
  testEq "ghcr.io/webhare/platform:release-4-35" "$BRANCH_IMAGES"
  testEq "docker.io/webhare/platform:release-4-35 docker.io/webhare/platform:4.35.0 ghcr.io/webhare/platform:4.35.0" "$PUBLIC_IMAGES"
  testEq "4.35.0" "$WEBHARE_VERSION"

  CI_COMMIT_REF_NAME=custom/customer
  CI_COMMIT_REF_SLUG=custom-customer

  echo ---- CI_COMMIT_REF_NAME=$CI_COMMIT_REF_NAME CI_COMMIT_REF_SLUG=$CI_COMMIT_REF_SLUG
  get_finaltag
  list_finaltag
  testEq "ghcr.io/webhare/platform:custom-customer" "$BRANCH_IMAGES"
  testEq "docker.io/webhare/platform:custom-customer" "$PUBLIC_IMAGES"
  testEq "4.35.0" "$WEBHARE_VERSION"
}

testToFsPath
testIsWasmEngine
testContainerTagCalculation

echo tests succeeded!
