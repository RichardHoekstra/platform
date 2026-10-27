import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { runCli } from "@webhare/cli";
import { CodeContext } from "@webhare/services/src/codecontexts";
import { isWorkOpen, onFinishWork, query, rollbackWork, runInWork } from "@webhare/whdb";
import { isDatabaseError } from "@webhare/whdb/src/impl";

runCli({ async main() {
  await using context = new CodeContext("issue-144 temporary-table reproduction");
  await context.run(async () => {
    const table = `repro144_${randomBytes(6).toString("hex")}`;
    await runInWork(() => query(`CREATE TEMP TABLE ${table} (attempt integer)`));
    let rollbackCallbacks = 0;
    let bodyCalls = 0;
    try {
      await assert.rejects(() => runInWork(async () => {
        await query(`INSERT INTO ${table} VALUES (0)`);
        onFinishWork({
          onCommit() { throw new Error("ordinary completion fault"); },
          onRollback() { ++rollbackCallbacks; }
        });
      }), /ordinary completion fault/);
      const controlRows = Number((await query<{ count: string }>(`SELECT count(*) AS count FROM ${table} WHERE attempt=0`)).rows[0].count);
      assert.equal(controlRows, 1);
      assert.equal(rollbackCallbacks, 0, "Control: merged #46 does not invoke rollback callbacks after COMMIT");
      const controlRollbackCallbacks = rollbackCallbacks;

      await assert.rejects(() => runInWork(async () => {
        ++bodyCalls;
        await query(`INSERT INTO ${table} VALUES ($1)`, [bodyCalls]);
        onFinishWork({
          async onCommit() {
            await query("DO $$ BEGIN RAISE EXCEPTION 'post-commit serialization fault' USING ERRCODE = '40001'; END $$");
          },
          onRollback() { ++rollbackCallbacks; }
        });
      }, { autoRetry: true, maxRetries: 3 }), error => isDatabaseError(error) && error.code === "40001");

      const committedRows = Number((await query<{ count: string }>(`SELECT count(*) AS count FROM ${table} WHERE attempt>0`)).rows[0].count);
      console.log("REPRO_144", JSON.stringify({ ordinaryCompletionError: { committedRows: controlRows, rollbackCallbacks: controlRollbackCallbacks },
        retryShapedCompletionError: { bodyCalls, committedRows, rollbackCallbacks },
        expectedBodyCalls: 1, replayObserved: bodyCalls > 1 }));
    } finally {
      if (isWorkOpen()) await rollbackWork();
      await runInWork(() => query(`DROP TABLE ${table}`));
    }
  });
} });
