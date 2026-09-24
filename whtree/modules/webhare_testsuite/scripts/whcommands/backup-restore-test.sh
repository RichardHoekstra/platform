#!/bin/bash

# short: Run the backup-restore-test

die()
{
  echo $1
  exit 1
}
die_help()
{
  cat << HERE
Error: $1

You can run this script manually by providing it with a WebHare container, eg:

MYIMAGE=webhare/platform:main
podman pull $MYIMAGE
rm -rf /tmp/backup-restore-test
export TESTENV_CONTAINER1="$(podman run -d -v /tmp/backup-restore-test:/opt/whdata --name wh-backup-restore-test $MYIMAGE)"
wh webhare_testsuite:backup-restore-test
HERE
  exit 1
}

set -x
set -e #Demand that all these commands succeed!

CONTAINERENGINE=docker
if [ "$USEPODMAN" == "1" ]; then
  CONTAINERENGINE=podman
fi

[ -z "$TESTENV_CONTAINER1" ] && die "Where is my TESTENV_CONTAINER1 ?"

"$CONTAINERENGINE" exec "$TESTENV_CONTAINER1" wh waitfor poststartdone || die "WebHare isn't starting"
"$CONTAINERENGINE" exec "$TESTENV_CONTAINER1" wh users adduser "backup-reference-user@example.net" || die "Cannot create user backup-reference-user@example.net"
"$CONTAINERENGINE" exec "$TESTENV_CONTAINER1" wh preparebackup --verbose
"$CONTAINERENGINE" exec "$TESTENV_CONTAINER1" sv -w 60 stop webhare

# Remove all whdata folders except for the prepared backup
"$CONTAINERENGINE" exec "$TESTENV_CONTAINER1" find /opt/whdata -mindepth 1 -maxdepth 1 -not -name preparedbackup -exec rm -rf {} \;

# Verify that the WebHare is empty
"$CONTAINERENGINE" exec "$TESTENV_CONTAINER1" sv start webhare
"$CONTAINERENGINE" exec "$TESTENV_CONTAINER1" wh waitfor poststartdone || die "Emptied WebHare isn't starting"
"$CONTAINERENGINE" exec "$TESTENV_CONTAINER1" wh users getuser "backup-reference-user@example.net" && die "User backup-reference-user@example.net shouldn't exist clearing WebHare"
# wait up to 60 seconds - we especially need postgres to be down or it will race us and still write to /opt/whdata/posgresql during the restore
"$CONTAINERENGINE" exec "$TESTENV_CONTAINER1" sv -w 60 stop webhare

# Again, remove all whdata folders except for the prepared backup
"$CONTAINERENGINE" exec "$TESTENV_CONTAINER1" find /opt/whdata -mindepth 1 -maxdepth 1 -not -name preparedbackup -exec rm -rf {} \;

# Tell WebHare to restore its data
"$CONTAINERENGINE" exec "$TESTENV_CONTAINER1" wh restore /opt/whdata/preparedbackup

# Restart it
"$CONTAINERENGINE" exec "$TESTENV_CONTAINER1" sv start webhare
"$CONTAINERENGINE" exec "$TESTENV_CONTAINER1" wh waitfor poststartdone || die "Restored WebHare isn't starting"
"$CONTAINERENGINE" exec "$TESTENV_CONTAINER1" wh users getuser "backup-reference-user@example.net" || die "User backup-reference-user@example.net SHOULD exist after restore"

# SUCCESS!
