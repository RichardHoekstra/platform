import type { PlatformDB } from "@mod-platform/generated/db/platform";
import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { beginWork, db, rollbackWork, runInWork } from "@webhare/whdb";
import { wrd, createSchema, deleteSchema } from "@webhare/wrd";
import { subscribeToEventStream } from "@webhare/services";
import { wrdFinishHandler } from "@webhare/wrd/src/finishhandler";

async function testDeleteScope() {
  await beginWork();
  try {
    await createSchema("webhare_testsuite:deletescope", { initialize: false });
    const schema = wrd<"*">("webhare_testsuite:deletescope");
    await schema.createType("testDomain_1", { metaType: "domain" });
    await schema.createType("testDomain1Child", { metaType: "domain", parent: "testDomain_1" });
    await schema.createType("testDomain_2", { metaType: "domain" });
    await createSchema("webhare_testsuite:deletescopeother", { initialize: false });
    const other = wrd<"*">("webhare_testsuite:deletescopeother");
    await other.createType("testDomain_1", { metaType: "domain" });
    const parent = await schema.__toWRDTypeId("testDomain_1");
    const child = await schema.__toWRDTypeId("testDomain1Child");
    const foreignType = await other.__toWRDTypeId("testDomain_1");
    const siblingType = await schema.__toWRDTypeId("testDomain_2");

    for (const mode of ["delete", "delete-denyreferred", "delete-closereferred"] as const) {
      const own = await schema.insert("testDomain_1", {});
      const descendant = await schema.insert("testDomain1Child", {});
      const sibling = await schema.insert("testDomain_2", {});
      const foreign = await other.insert("testDomain_1", {});
      // Includes valid, foreign, duplicate and nonexistent IDs in the same call.
      await schema.close("testDomain_1", [own, descendant, sibling, foreign, own, -1], { mode });
      const surviving = await db<PlatformDB>().selectFrom("wrd.entities").select("id")
        .where("id", "in", [own, descendant, sibling, foreign]).orderBy("id").execute();
      test.eq([sibling, foreign].sort((a, b) => a - b).map(id => ({ id })), surviving,
        `${mode}: sibling and other-schema entities must survive`);
      const changes = wrdFinishHandler().typeChanges;
      test.assert(changes.get(parent)?.deleted?.has(own));
      test.assert(changes.get(child)?.deleted?.has(descendant), "Deletion must use the actual subtype identity");
      test.assert(!changes.get(parent)?.deleted?.has(descendant));
      test.assert(!changes.get(parent)?.deleted?.has(-1), "Missing IDs must not produce deletion evidence");
      test.assert(!changes.get(siblingType)?.deleted?.has(sibling));
      test.assert(!changes.get(foreignType)?.deleted?.has(foreign));
      test.assert(!changes.get(parent)?.deleted?.has(sibling));
      test.assert(!changes.get(parent)?.deleted?.has(foreign));
    }
  } finally {
    await rollbackWork();
  }
}

async function testCommittedDeleteEvents() {
  const schema = wrd<"*">("webhare_testsuite:deleteevents");
  const setup = await runInWork(async () => {
    const schemaId = await createSchema(schema.tag, { initialize: false });
    await schema.createType("parent", { metaType: "domain" });
    await schema.createType("child", { metaType: "domain", parent: "parent" });
    await schema.createType("sibling", { metaType: "domain" });
    return {
      schemaId, parentType: await schema.__toWRDTypeId("parent"), childType: await schema.__toWRDTypeId("child"),
      own: await schema.insert("parent", {}), child: await schema.insert("child", {}),
      sibling: await schema.insert("sibling", {}),
    };
  });
  try {
    using stream = subscribeToEventStream("wrd:type.*");
    const iterator = stream[Symbol.asyncIterator]();
    await runInWork(() => schema.delete("parent", [setup.own, setup.child, setup.sibling, -1]));
    // Observe real post-commit events; unrelated background events may interleave.
    const expected = new Map([[`wrd:type.${setup.parentType}.change`, setup.own], [`wrd:type.${setup.childType}.change`, setup.child]]);
    const abort = new AbortController();
    const timeout = test.sleep(10000, { signal: abort.signal }).then(() => { throw new Error("Missing committed deletion event"); });
    try {
      while (expected.size) {
        const event = await Promise.race([iterator.next(), timeout]);
        test.assert(!event.done);
        const id = expected.get(event.value.name);
        if (id !== undefined) {
          test.eq({ allinvalidated: false, created: [], updated: [], deleted: [id] }, event.value.data);
          expected.delete(event.value.name);
        }
      }
    } finally {
      abort.abort();
    }
    test.eq([{ id: setup.sibling }], await db<PlatformDB>().selectFrom("wrd.entities").select("id")
      .where("id", "in", [setup.own, setup.child, setup.sibling]).execute());
  } finally {
    await runInWork(() => deleteSchema(setup.schemaId));
  }
}

test.runTests([testDeleteScope, testCommittedDeleteEvents]);
