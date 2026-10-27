# Async lifecycle issue reproductions

Small fixtures for [#142](https://github.com/WebHare/platform/issues/142), [#143](https://github.com/WebHare/platform/issues/143), [#144](https://github.com/WebHare/platform/issues/144) and [#145](https://github.com/WebHare/platform/issues/145). This branch adds reproduction files only; it contains no production implementation changes.

Pinned baseline: GitHub main `a91a7a28cca92a67220ca22c1b715043d390c8c3`, official WebHare 6.2.0 Linux/amd64 image. The fixtures use existing APIs and run without installing `webhare_testsuite` or applying any proposed fix.

## One-command Docker run

Check out the reproduction branch from `RichardHoekstra/platform` (the issue comments link an immutable source revision). Python 3 and Docker are the only host dependencies:

```sh
git clone --depth 1 --branch repro/async-lifecycle-20261027 https://github.com/RichardHoekstra/platform.git webhare-issue-repros
cd webhare-issue-repros
```

From that repository root:

```sh
python3 whtree/modules/platform/scripts/repro/run.py --docker all --output /tmp/webhare-issue-repros
```

The output directory must not already exist. The runner creates one fresh instance per case, uses an internal Docker network with no published ports, waits for that boot's poststart completion, bounds each reproduction to 30 seconds and removes its containers and networks afterward. Each container has 4 GiB RAM and 6 GiB combined RAM/swap. The pinned image is downloaded if absent; Docker storage holds the temporary databases and caches.

Run one issue by replacing `all` with its number. `--keep` retains the containers and networks for inspection; their names are printed for explicit cleanup.

`all` also runs the three #143 follow-up probes: `143-handover`, `143-codec` and `143-calljs`. Each can be selected individually using the same command.

## Existing development instance

With this checkout providing the running instance's `platform` module:

```sh
python3 whtree/modules/platform/scripts/repro/run.py 142
```

Use a disposable development instance. In particular, #143 restarts `platform:calljs`; #144 uses a real PostgreSQL session and a temporary table. The runner terminates the local command's process group after 30 seconds.

| Issue | Fixture | Outcome on the pinned baseline |
|---|---|---|
| [#142](issue-142/README.md) | Worker retirement | 4 worker allocations with `maxWorkers=2`; all 8 calls drain |
| [#143](issue-143/README.md) | Logical service restart | `already registered` error; process exit 1 |
| [#144](issue-144/README.md) | Retry after acknowledged COMMIT | 3 body calls and 3 committed temporary rows |
| [#145](issue-145/README.md) | Detached rejection | 8 rejected callers while all 8 targets complete |
| [#143 handover](issue-143/README.md#unix-follow-ups) | Overlapping Unix listeners | Closing A removes B's published path; established clients survive |
| [#143 codec](issue-143/README.md#unix-follow-ups) | Native HS value compatibility | Blob and INTEGER64 gaps compared with binary IPC |
| [#143 CallJS](issue-143/README.md#unix-follow-ups) | Raw native HS socket client | 3 numeric invocations of stock CallJS return 42 |

For #142, #144 and #145, exit 0 means the characterization completed. Read the printed `REPRO_<issue>` JSON for the observation. It does not mean the reported behavior is fixed. The Unix follow-ups assert the documented baseline observations and exit 0 on that baseline. #143's restart case exits nonzero when the restart fails, so an `all` run on the baseline exits 1 after collecting all seven results. Exit 124 indicates an execution deadline (137 if forced termination was needed); exit 2 indicates runner/setup failure.

These are focused observations. The fixtures do not establish a production exposure level, a preferred worker-capacity policy, or the correctness of a proposed restart architecture. Per-issue notes state the relevant boundaries.
