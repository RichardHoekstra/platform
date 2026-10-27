# #142: worker retirement allocation

```sh
python3 whtree/modules/platform/scripts/repro/run.py --docker 142
```

`main.ts` configures `maxWorkers=2` and `maxCallsPerWorker=2`, then starts eight callbacks behind one shared barrier. It records allocation while the callbacks are held, releases the barrier, checks every result, closes the pool and waits for worker exit.

On main `a91a7a28`, the `REPRO_142` record reports `allocatedWorkers: 4`, `startedCalls: 8` and `completedCalls: 8`.

This characterizes temporary allocation during retirement. It does not show a permanent leak. Whether replacement should wait for old workers to exit or preserve executor availability through overshoot is the policy question raised in [#142](https://github.com/WebHare/platform/issues/142). No permanent-close or OpenAPI-cache proposal is installed by this fixture.
