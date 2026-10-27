import assert from "node:assert/strict";
import { runCli } from "@webhare/cli";
import { WorkerPool } from "@mod-system/js/internal/openapi/workerpool";
import type { AsyncWorker } from "@mod-system/js/internal/worker";

runCli({ async main() {
  const pool = new WorkerPool("issue-142", 2, 2);
  const gate = Promise.withResolvers<void>();
  const workers = new Set<AsyncWorker>();
  const exits: Array<Promise<void>> = [];
  let started = 0;
  let exited = 0;
  const pending = Array.from({ length: 8 }, (_, token) => pool.runInWorker(async worker => {
    ++started;
    if (!workers.has(worker)) {
      workers.add(worker);
      // AsyncWorker only exposes "error"; observe its underlying Node thread.
      exits.push(new Promise<void>(resolve => worker["worker"].once("exit", () => { ++exited; resolve(); })));
    }
    await gate.promise;
    return token;
  }));
  const held = { configuredMaxWorkers: pool.maxWorkers, maxCallsPerWorker: pool.maxCallsPerWorker,
    allocatedWorkers: pool.workers.length, startedCalls: started };
  try {
    gate.resolve();
    assert.deepEqual(await Promise.all(pending), [0, 1, 2, 3, 4, 5, 6, 7]);
  } finally {
    gate.resolve();
    await Promise.allSettled(pending);
    pool.close();
    await Promise.all(exits);
  }
  assert.equal(exited, workers.size, "Every observed Node thread exited");
  console.log("REPRO_142", JSON.stringify({ ...held, completedCalls: pending.length, exitedWorkers: exited,
    overshootObserved: held.allocatedWorkers > held.configuredMaxWorkers,
    interpretation: "Retirement allocation characterization; whether overshoot is intended is a policy question" }));
} });
