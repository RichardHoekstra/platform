# #143: logical backend-service restart

```sh
python3 whtree/modules/platform/scripts/repro/run.py --docker 143
```

The native HareScript caller warms up `platform:calljs` using the adjacent synthetic addition function. It opens `platform:services.node` and awaits up to ten `Restart("platform:calljs")` RPC calls. The hosting nodeservices process stays running; the fixture does not invoke the `wh service restart` CLI.

On main `a91a7a28`, the first restart can fail with:

```text
Port name "webhareservice:platform:calljs" was already registered
```

The exception and stack are printed and the caller exits 1. A successful run prints `ten logical restarts completed` and exits 0. The manager client closes in `finally`.

Run this in a disposable instance: the test intentionally restarts an existing platform service. It reproduces the current release/rebind failure, without installing `closeAsync()` or a Unix-socket handover implementation. The separate handover design discussion in [#143](https://github.com/WebHare/platform/issues/143) remains open.

## Unix follow-ups

The runtime evidence in the issue's later comments is included too. Select one case with the same runner:

```sh
python3 whtree/modules/platform/scripts/repro/run.py --docker 143-handover
python3 whtree/modules/platform/scripts/repro/run.py --docker 143-codec
python3 whtree/modules/platform/scripts/repro/run.py --docker 143-calljs
```

- `handover.ts` runs a cleanup-before-replacement control and three overlapping generations of a Unix-only synthetic service. The control succeeds. During overlap, fresh clients reach B while old clients still reach A; closing A removes the published path, although both established connections still work. Fresh connections then fail. Clients and listeners close in `finally`.
- `codec.ts` starts a synthetic service with bridge and Unix transports, then invokes `codec-client.whscr`. It compares native HS binary IPC with raw typed-JSON socket messages: Money and Date agree, blobs become strings on the HS-to-socket path, and INTEGER64 loses precision above the safe integer range. The native decoder rejects TS's lowercase `bigint` tag. Temporary blob files are removed in `finally`; this is not a large-blob or lifetime benchmark.
- `socket-calljs.ts` invokes `socket-calljs-client.whscr`. After a regular CallJS warm-up, a native HS socket client sends `constructor` and `invoke` messages directly to the stock Unix listener. Three synthetic `20 + 22` calls return `42`. This does not implement generic HS service proxies or preserve synchronous CallJS semantics.

These follow-ups assert observations on the pinned baseline. A changed transport or cleanup implementation can require updating those assertions. No proposed transport implementation is installed.
