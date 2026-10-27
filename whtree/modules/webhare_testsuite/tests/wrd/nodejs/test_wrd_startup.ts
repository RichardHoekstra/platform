import { execFileSync } from "node:child_process";
import * as test from "@webhare/test";

test.runTests([
  function testWRDStartupDoesNotLoadCodeGenerators() {
    // Use a fresh process: the test runner itself may already use generators.
    // Check the runtime dependency graph, without a machine-dependent time limit.
    execFileSync("wh", ["node", "-e", `
      const assert = require('node:assert/strict');
      const wrd = require('@webhare/wrd');
      assert.equal(typeof wrd.importIntoWRDSchema, 'function');
      const eager = Object.keys(require.cache).filter(path =>
        /[/\\\\]typescript[/\\\\]lib[/\\\\]typescript\\.js$/.test(path) ||
        /[/\\\\]generation[/\\\\]gen_openapi\\.ts$/.test(path));
      assert.deepEqual(eager, [], 'WRD startup loaded code generators');
    `], { stdio: ["ignore", "pipe", "pipe"] });
  },
  function testDeferredYAMLValidationStillRuns() {
    execFileSync("wh", ["node", "-e", `
      const assert = require('node:assert/strict');
      const { wrd, importIntoWRDSchema } = require('@webhare/wrd');
      void (async () => {
        const schema = wrd('wrd:testschema');
        assert.deepEqual(await importIntoWRDSchema(schema, 'types: {}'), {byType: {}, byName: {}});
        await assert.rejects(importIntoWRDSchema(schema, 'types: ['), /Invalid YAML/);
        await assert.rejects(importIntoWRDSchema(schema, '[]'), /Expected top-level YAML document/);
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `], { stdio: ["ignore", "pipe", "pipe"] });
  }
]);
