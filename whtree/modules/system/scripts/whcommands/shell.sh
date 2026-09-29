# shellcheck shell=bash
# short: Launch a shell within the WebHare environment

export HOME="${WEBHARE_DATAROOT}root"
mkdir -p "${WEBHARE_DATAROOT}root"

SET_BASH_OPTS=()
if [ -n "$WEBHARE_CHECKEDOUT_TO" ]; then
  SET_BASH_OPTS+=(--rcfile "${WEBHARE_CHECKEDOUT_TO}/addons/docker-build/dropins/etc/profile.d/webhare.sh")
fi

exec bash "${SET_BASH_OPTS[@]}" -O histappend -O cmdhist
