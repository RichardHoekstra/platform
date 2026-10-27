# #145: detached rejection in a shared CallAsync runner

```sh
python3 whtree/modules/platform/scripts/repro/run.py --docker 145
```

The native caller runs two groups of eight overlapping calls to the adjacent TS module:

- A rejection returned by one target: 1 rejected caller, 7 fulfilled callers, 8 completed targets.
- A detached rejected Promise created by one target: 8 rejected callers, 0 fulfilled callers, 8 completed targets.

Each group resets its counters, settles the callers, waits another 80 ms and queries completion in the same runner. `REPRO_145` prints both results and reports runner identity through `same_runner`.

Targets use short timers and in-memory counters. There are no application writes, requests to external services or filesystem markers. The runner process belongs to the native caller and is released when that caller exits.

The observation in [#145](https://github.com/WebHare/platform/issues/145) concerns failed callers whose target work continues. It does not argue that unrelated calls must survive an unhandled process-level error. The maintainer's proposed fatal-runner policy needs its own implementation and regression expectations.
