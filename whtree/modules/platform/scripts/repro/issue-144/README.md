# #144: retry after acknowledged COMMIT

```sh
python3 whtree/modules/platform/scripts/repro/run.py --docker 144
```

`main.ts` creates a randomly named PostgreSQL temporary table in its own `CodeContext` and runs two cases:

1. An ordinary `onCommit` exception: one row remains committed and no rollback callback runs. This confirms the behavior fixed by [#46](https://github.com/WebHare/platform/pull/46).
2. An `onCommit` hook raises a real PostgreSQL `40001` error after COMMIT. With `autoRetry: true, maxRetries: 3`, main `a91a7a28` executes the body three times and commits three temporary rows.

The `REPRO_144` record reports the measured counts and `replayObserved`. The expected transaction behavior is one body execution: an acknowledged commit must not be replayed because completion work fails. The fixture still prints a meaningful result when that behavior is fixed.

The table is dropped in `finally`; its temporary scope also limits its lifetime to the connection. No existing application table is modified. Unknown COMMIT acknowledgements and the older broad transaction proposal are outside this reproduction.
