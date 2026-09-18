/* Tests the parts of WRD history that make committed changes fully observable:
   - deletions are recorded as an explicit historical fact
   - effects cascading from a deletion are recorded with the deletion as their cause
   - every changeset is numbered in commit order, and the schema's history head only advances on commit
*/
import { wrd, createSchema, deleteSchema, setChangeSource, type WRDSchemaLike } from "@webhare/wrd";
import { updateAuditContext } from "@webhare/auth";
import { decodeHSON } from "@webhare/hscompat";
import * as test from "@webhare/test";
import * as whdb from "@webhare/whdb";
import { createWRDTestSchema, testSchemaTag, type CustomExtensions } from "@mod-webhare_testsuite/js/wrd/testhelpers";
import type { Combine } from "@webhare/wrd/src/types";
import { loadlib, type HSVMObject } from "@webhare/harescript";
import { db, runInSeparateWork, runInWork } from "@webhare/whdb";
import { CodeContext } from "@webhare/services/src/codecontexts";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { readAnyFromDatabase } from "@webhare/whdb/src/formats";
import { encodeWRDGuid } from "@webhare/wrd/src/accessors";
import { throwError } from "@webhare/std";

type WRD_TestschemaSchemaType = WRDSchemaLike["wrd:testschema"];

function getSchema() {
  return wrd<Combine<[WRD_TestschemaSchemaType, CustomExtensions]>>(testSchemaTag);
}

/** Whitebox: all history rows in the schema, in commit order */
async function listHistory(schemaId: number) {
  const rows = await db<PlatformDB>()
    .selectFrom("wrd.changes")
    .innerJoin("wrd.changesets", "wrd.changesets.id", "wrd.changes.changeset")
    .where("wrd.changesets.wrdschema", "=", schemaId)
    .select(["wrd.changes.id", "wrd.changes.changeset", "wrd.changesets.historyseqnr", "wrd.changes.entity", "wrd.changes.cause", "wrd.changes.summary", "wrd.changes.modifications", "wrd.changes.modifications_blob"])
    .orderBy("wrd.changes.id")
    .execute();
  return Promise.all(rows.map(async row => ({
    ...row,
    entity: encodeWRDGuid(row.entity),
    deleted: Boolean(((await readAnyFromDatabase(row.modifications, row.modifications_blob)) as { deleted?: boolean } | null)?.deleted),
  })));
}

async function testHistoryDisabled() {
  await createWRDTestSchema({ keepHistoryDays: 0 });
  const wrdschema = getSchema();
  const schemaId = await wrdschema.getId();
  test.eq(0, await wrdschema.getHistoryHead());
  test.eq([], await listHistory(schemaId));

  await whdb.beginWork();
  const testunit = await wrdschema.insert("whuserUnit", { wrdTitle: "Root unit", wrdTag: "TAG" });
  const person = await wrdschema.insert("wrdPerson", { wrdContactEmail: "nohistory@example.com", whuserUnit: testunit, wrdauthAccountStatus: { status: "active" } });
  await wrdschema.insert("personattachment", { wrdLeftEntity: person, attachfree: "attached" });
  await wrdschema.update("wrdPerson", person, { wrdFirstName: "Updated" });
  await wrdschema.delete("wrdPerson", person);
  await whdb.commitWork();

  // Without history nothing is recorded and the head doesn't move
  test.eq([], await listHistory(schemaId));
  test.eq([], await db<PlatformDB>().selectFrom("wrd.changesets").select("id").where("wrdschema", "=", schemaId).execute());
  test.eq(0, await wrdschema.getHistoryHead());
}

async function testDeletesAndHead() {
  await createWRDTestSchema({ keepHistoryDays: 1 });
  const wrdschema = getSchema();
  const schemaId = await wrdschema.getId();
  const hsWrdSchema = await loadlib("mod::wrd/lib/api.whlib").OpenWRDSchema(testSchemaTag) as HSVMObject;
  const hsPersontype = await hsWrdSchema.getType("WRD_PERSON") as HSVMObject;
  const hsAttachmenttype = await hsWrdSchema.getType("PERSONATTACHMENT") as HSVMObject;

  await whdb.beginWork();
  const testunit = await wrdschema.insert("whuserUnit", { wrdTitle: "Root unit", wrdTag: "TAG" });
  await whdb.commitWork();

  const domainvalue = await wrdschema.find("testDomain_2", { wrdTag: "TEST_DOMAINVALUE_2_2" }) ?? throwError("Domain value not found");
  const head0 = await wrdschema.getHistoryHead();
  const history0 = await listHistory(schemaId);

  // STORY: a normal update is recorded, and the head only advances when the work commits
  await whdb.beginWork();
  const personA = await wrdschema.insert("wrdPerson", { wrdContactEmail: "a@example.com", whuserUnit: testunit, wrdauthAccountStatus: { status: "active" }, testMultipleDomain: [domainvalue] });
  test.eq(head0, await wrdschema.getHistoryHead(), "head must not move inside the work");
  test.eq(head0, await runInSeparateWork(() => wrdschema.getHistoryHead()), "head must not be visible to others before commit");
  await whdb.commitWork();
  test.eq(head0 + 1, await wrdschema.getHistoryHead());
  test.eqPartial([{ historyseqnr: head0 + 1 }], await hsPersontype.ListChangesets(personA));

  // STORY: rollback leaves nothing behind - no head advance, no changeset, no change
  await whdb.beginWork();
  await wrdschema.update("wrdPerson", personA, { wrdFirstName: "Rolled back" });
  test.eq(history0.length + 2, (await listHistory(schemaId)).length, "change should be visible inside the work");
  await whdb.rollbackWork();
  test.eq(head0 + 1, await wrdschema.getHistoryHead());
  test.eq(history0.length + 1, (await listHistory(schemaId)).length);
  test.eq(1, (await db<PlatformDB>().selectFrom("wrd.changesets").select("id").where("wrdschema", "=", schemaId).where("historyseqnr", ">", head0).execute()).length);

  // STORY: a delete is an explicit historical fact
  await whdb.beginWork();
  const personB = await wrdschema.insert("wrdPerson", { wrdContactEmail: "b@example.com", wrdFirstName: "Bob", whuserUnit: testunit, wrdauthAccountStatus: { status: "active" }, testFree: "Free field" });
  await whdb.commitWork();
  const personBGuid = (await wrdschema.getFields("wrdPerson", personB, ["wrdGuid"])).wrdGuid;
  const headBeforeDelete = await wrdschema.getHistoryHead();

  await whdb.beginWork();
  await wrdschema.delete("wrdPerson", personB);
  await whdb.commitWork();

  test.eq(null, await wrdschema.getFields("wrdPerson", personB, ["wrdGuid"], { allowMissing: true, historyMode: "all" }), "entity must really be gone");
  test.eq(headBeforeDelete + 1, await wrdschema.getHistoryHead());
  const deleteChanges = (await listHistory(schemaId)).filter(row => row.entity === personBGuid);
  test.eqPartial([
    { deleted: false, cause: null }, // the insert
    { deleted: true, cause: null, historyseqnr: headBeforeDelete + 1, summary: "testFree,whuserUnit,wrdContactEmail,wrdauthAccountStatus" },
  ], deleteChanges);
  test.eqPartial([
    {
      changetype: "delete",
      cause: 0,
      oldsettings: { wrd_contact_email: "b@example.com", wrd_firstname: "Bob", test_free: "Free field" },
      modifications: { test_free: "" },
    }
  ], await hsPersontype.GetChanges(deleteChanges[1].changeset));

  // STORY: effects cascading from a delete are recorded with the delete as their cause, atomically with the delete
  await whdb.beginWork();
  const personC = await wrdschema.insert("wrdPerson", { wrdContactEmail: "c@example.com", whuserUnit: testunit, wrdauthAccountStatus: { status: "active" } });
  const attachment = await wrdschema.insert("personattachment", { wrdLeftEntity: personC, attachfree: "attached to C" });
  const personD = await wrdschema.insert("wrdPerson", { wrdContactEmail: "d@example.com", whuserUnit: testunit, wrdauthAccountStatus: { status: "active" }, personlink: personC, testMultipleDomain: [domainvalue] });
  await whdb.commitWork();
  const personCGuid = (await wrdschema.getFields("wrdPerson", personC, ["wrdGuid"])).wrdGuid;
  const attachmentGuid = (await wrdschema.getFields("personattachment", attachment, ["wrdGuid"])).wrdGuid;
  const personDGuid = (await wrdschema.getFields("wrdPerson", personD, ["wrdGuid"])).wrdGuid;
  const headBeforeCascade = await wrdschema.getHistoryHead();
  const historyBeforeCascade = await listHistory(schemaId);

  await whdb.beginWork();
  await wrdschema.update("wrdPerson", personA, { wrdFirstName: "Alice" }); //an unrelated change in the same work
  await wrdschema.delete("wrdPerson", personC);
  // Nothing of this work is visible to others yet - not even partially
  test.eq(headBeforeCascade, await runInSeparateWork(() => wrdschema.getHistoryHead()));
  test.eq(historyBeforeCascade.length, await runInSeparateWork(async () => (await listHistory(schemaId)).length));
  await whdb.commitWork();

  test.eq(headBeforeCascade + 1, await wrdschema.getHistoryHead());
  const cascade = (await listHistory(schemaId)).slice(historyBeforeCascade.length);
  test.eq(4, cascade.length, "update A, delete C, delete attachment, edit D");
  test.eq(1, new Set(cascade.map(row => row.changeset)).size, "one work, one changeset");
  test.eq([headBeforeCascade + 1], [...new Set(cascade.map(row => row.historyseqnr))]);

  const deleteC = cascade.find(row => row.entity === personCGuid) ?? throwError("Missing delete of C");
  test.eqPartial({ deleted: true, cause: null }, deleteC);
  test.eqPartial({ deleted: true, cause: deleteC.id, summary: "attachfree" }, cascade.find(row => row.entity === attachmentGuid));
  test.eqPartial({ deleted: false, cause: deleteC.id, summary: "personlink" }, cascade.find(row => row.entity === personDGuid));
  test.eqPartial({ deleted: false, cause: null, summary: "wrdFirstName" }, cascade.find(row => row.entity !== personCGuid && row.entity !== attachmentGuid && row.entity !== personDGuid));
  test.eq(null, await wrdschema.getFields("personattachment", attachment, ["wrdGuid"], { allowMissing: true, historyMode: "all" }), "attachment must have cascaded");
  test.eq(null, (await wrdschema.getFields("wrdPerson", personD, ["personlink"])).personlink, "reference must have cascaded");

  // The HareScript history API reports the same facts
  test.eqPartial([
    { entity: personD, changetype: "edit", cause: deleteC.id, modifications: { personlink: 0 } },
  ], (await hsPersontype.GetChanges(deleteC.changeset, { filterentities: [personD] })));
  test.eqPartial([
    { changetype: "delete", cause: deleteC.id, oldsettings: { attachfree: "attached to C" } },
  ], await hsAttachmenttype.GetChanges(deleteC.changeset));

  // STORY: a cascade from a type without history is still recorded for the affected type, without a cause
  const headBeforeDomainDelete = await wrdschema.getHistoryHead();
  await whdb.beginWork();
  await wrdschema.delete("testDomain_2", domainvalue);
  await whdb.commitWork();
  test.eq(headBeforeDomainDelete + 1, await wrdschema.getHistoryHead());
  const personAGuid = (await wrdschema.getFields("wrdPerson", personA, ["wrdGuid"])).wrdGuid;
  const domainCascade = (await listHistory(schemaId)).filter(row => row.historyseqnr === headBeforeDomainDelete + 1);
  test.eq([personAGuid, personDGuid].toSorted(), domainCascade.map(row => row.entity).toSorted(), "only the two persons referring to the domain value are affected");
  test.eqPartial([
    { deleted: false, cause: null, summary: "testMultipleDomain" },
    { deleted: false, cause: null, summary: "testMultipleDomain" },
  ], domainCascade);
  test.eq([], (await wrdschema.getFields("wrdPerson", personD, ["testMultipleDomain"])).testMultipleDomain);

  // STORY: the HareScript API records deletes and numbers changesets the same way
  await whdb.beginWork();
  const personE = await wrdschema.insert("wrdPerson", { wrdContactEmail: "e@example.com", whuserUnit: testunit, wrdauthAccountStatus: { status: "active" }, testFree: "Deleted through HareScript" });
  await whdb.commitWork();
  const personEGuid = (await wrdschema.getFields("wrdPerson", personE, ["wrdGuid"])).wrdGuid;
  const headBeforeHS = await wrdschema.getHistoryHead();

  await whdb.beginWork();
  await hsPersontype.DeleteEntity(personE);
  await whdb.commitWork();
  test.eq(headBeforeHS + 1, await wrdschema.getHistoryHead());
  const hsDelete = (await listHistory(schemaId)).filter(row => row.entity === personEGuid && row.deleted);
  test.eqPartial([{ deleted: true, cause: null, historyseqnr: headBeforeHS + 1 }], hsDelete);
  test.eq(["TEST_FREE", "WHUSER_UNIT", "WRDAUTH_ACCOUNT_STATUS", "WRD_CONTACT_EMAIL"], hsDelete[0].summary.split(",").toSorted(), "HareScript summarizes with HareScript attribute names");
  test.eqPartial([{ changetype: "delete", cause: 0, oldsettings: { test_free: "Deleted through HareScript" } }], await hsPersontype.GetChanges(hsDelete[0].changeset));

  await whdb.beginWork();
  const hsChangeset = await hsWrdSchema.CreateChangeSet() as number; //created and registered by HareScript
  test.eq(headBeforeHS + 1, await runInSeparateWork(() => wrdschema.getHistoryHead()));
  await whdb.commitWork();
  test.eq(headBeforeHS + 2, await wrdschema.getHistoryHead());
  test.eqPartial([{ historyseqnr: headBeforeHS + 2 }], await db<PlatformDB>().selectFrom("wrd.changesets").select("historyseqnr").where("id", "=", hsChangeset).execute());

  // STORY: changesets carry the acting user, changes carry the source of the work they were made in
  updateAuditContext({ actionBy: personA, actionByLogin: "alice@example.com" });
  await whdb.beginWork();
  setChangeSource({ task: "test_wrd_history_deletes", digest: "sha256:0123" });
  await wrdschema.update("wrdPerson", personD, { wrdFirstName: "Sourced" });
  await wrdschema.delete("wrdPerson", personD);
  await whdb.commitWork();

  const sourced = await db<PlatformDB>().selectFrom("wrd.changesets").selectAll().where("wrdschema", "=", schemaId).orderBy("historyseqnr", "desc").executeTakeFirstOrThrow();
  test.eq(personA, sourced.entity, "changeset records the acting user");
  test.eqPartial({ login: "alice@example.com" }, decodeHSON(sourced.userdata), "the changeset describes the acting user the way the changes screen reads it");
  test.eqPartial([ // (entity reads 0: D no longer exists, so its guid can't be mapped back to an id)
    { changetype: "edit", source: { task: "test_wrd_history_deletes", digest: "sha256:0123" } },
    { changetype: "delete", source: { task: "test_wrd_history_deletes", digest: "sha256:0123" } },
  ], await hsPersontype.GetChanges(sourced.id));

  // The source belongs to the work: the next work starts without one (the acting user is still known). HareScript can set it too
  await whdb.beginWork();
  await wrdschema.update("wrdPerson", personA, { wrdFirstName: "Unsourced" });
  await whdb.commitWork();
  const unsourced = (await hsPersontype.ListChangesets(personA)).at(-1)!;
  test.eqPartial({ entity: personA, userdata: { login: "alice@example.com" } }, unsourced);
  test.eqPartial([{ entity: personA, changetype: "edit", source: null }], await hsPersontype.GetChanges(unsourced.id));

  await whdb.beginWork();
  await loadlib("mod::wrd/lib/api.whlib").SetWRDChangeSource({ task: "hs" });
  await hsPersontype.DeleteEntity(personA);
  await whdb.commitWork();
  const hsSourced = await db<PlatformDB>().selectFrom("wrd.changesets").selectAll().where("wrdschema", "=", schemaId).orderBy("historyseqnr", "desc").executeTakeFirstOrThrow();
  test.eqPartial([{ changetype: "delete", source: { task: "hs" } }], await hsPersontype.GetChanges(hsSourced.id));

  // STORY: an audit context naming an entity that no longer exists must not break the changeset it describes
  await whdb.beginWork();
  await wrdschema.insert("wrdPerson", { wrdContactEmail: "stale@example.com", whuserUnit: testunit, wrdauthAccountStatus: { status: "active" } });
  await whdb.commitWork();
  const staleActor = await db<PlatformDB>().selectFrom("wrd.changesets").selectAll().where("wrdschema", "=", schemaId).orderBy("historyseqnr", "desc").executeTakeFirstOrThrow();
  test.eq(null, staleActor.entity, "a user that no longer exists cannot be referred to");
  test.eqPartial({ login: "alice@example.com" }, decodeHSON(staleActor.userdata), "but the identity we were given is still described");
  updateAuditContext({ actionBy: null, actionByLogin: "" });

  // STORY: deleting through the entity object (the route the WRD browser takes) is recorded as well
  await whdb.beginWork();
  const viaEntity = await wrdschema.insert("wrdPerson", { wrdContactEmail: "viaentity@example.com", whuserUnit: testunit, wrdauthAccountStatus: { status: "active" } });
  await whdb.commitWork();
  const viaEntityGuid = (await wrdschema.getFields("wrdPerson", viaEntity, ["wrdGuid"])).wrdGuid;
  const headBeforeEntityDelete = await wrdschema.getHistoryHead();

  await whdb.beginWork();
  await (await hsPersontype.getEntity(viaEntity) as HSVMObject).DeleteEntity();
  await whdb.commitWork();

  test.eq(headBeforeEntityDelete + 1, await wrdschema.getHistoryHead());
  test.eqPartial([{ deleted: true, historyseqnr: headBeforeEntityDelete + 1 }], (await listHistory(schemaId)).filter(row => row.entity === viaEntityGuid && row.deleted));
  test.eq(null, await wrdschema.getFields("wrdPerson", viaEntity, ["wrdGuid"], { allowMissing: true, historyMode: "all" }));

  // Every committed changeset got a unique number and the head is the highest one: the head is a complete observation point
  const numbered = await db<PlatformDB>().selectFrom("wrd.changesets").select("historyseqnr").where("wrdschema", "=", schemaId).orderBy("historyseqnr").execute();
  test.eq(numbered.length, new Set(numbered.map(_ => _.historyseqnr)).size);
  test.eq(await wrdschema.getHistoryHead(), numbered.at(-1)?.historyseqnr);
  test.eq(0, numbered.filter(_ => !_.historyseqnr).length, "all changesets should have been numbered");
}

/* The head is advanced inside the commit, so two works that touch the same schemas must take those row locks in a
   fixed order. Also checks that the resulting numbering is a single commit order, consistent across schemas. */
async function testConcurrentHeadNumbering() {
  const tags = ["webhare_testsuite:historyheadone", "webhare_testsuite:historyheadtwo"];
  const schemaIds = await runInWork(async () => {
    const created: number[] = [];
    for (const tag of tags) {
      created.push(await createSchema(tag, { initialize: false }));
      await wrd<"*">(tag).createType("thing", { metaType: "domain", keepHistoryDays: 1 });
    }
    return created;
  });
  const schemas = tags.map(tag => wrd<"*">(tag));
  /// Insert one entity per schema, visiting the schemas in the given order, and return the guids by schema position
  const insertEach = async (order: number[]): Promise<string[]> => {
    const guids: string[] = [];
    for (const pos of order) {
      const id = await schemas[pos].insert("thing", {});
      guids[pos] = (await schemas[pos].getFields("thing", id, ["wrdGuid"])).wrdGuid ?? throwError("Entity has no guid");
    }
    return guids;
  };
  const seqnrOf = async (pos: number, guid: string) =>
    (await listHistory(schemaIds[pos])).find(row => row.entity === guid)?.historyseqnr;

  try {
    // Sequential works: every committed changeset advances its schema's head by exactly one
    const before = await Promise.all(schemas.map(schema => schema.getHistoryHead()));
    const first = await runInWork(() => insertEach([0, 1]));
    const second = await runInWork(() => insertEach([0, 1]));
    test.eq(before.map(head => head + 2), await Promise.all(schemas.map(schema => schema.getHistoryHead())));
    for (const pos of [0, 1]) {
      test.eq(before[pos] + 1, await seqnrOf(pos, first[pos]));
      test.eq(before[pos] + 2, await seqnrOf(pos, second[pos]));
    }

    /* Two works that touch both schemas in opposite order, committing at the same time. Ordered locking makes this
       safe; taking the locks in the order the changesets were created would let these two deadlock. */
    for (let round = 0; round < 5; ++round) {
      const heads = await Promise.all(schemas.map(schema => schema.getHistoryHead()));
      const ready = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
      const work = async (index: number, order: number[]) => {
        await whdb.beginWork();
        const guids = await insertEach(order);
        // Both works hold a changeset in both schemas before either starts committing
        ready[index].resolve();
        await ready[1 - index].promise;
        await whdb.commitWork();
        return guids;
      };
      const [left, right] = await Promise.all([
        new CodeContext("wrd history head #1").run(() => work(0, [0, 1])),
        new CodeContext("wrd history head #2").run(() => work(1, [1, 0])),
      ]);

      test.eq(heads.map(head => head + 2), await Promise.all(schemas.map(schema => schema.getHistoryHead())));
      const order = await Promise.all([0, 1].map(async pos => {
        const [leftSeqnr, rightSeqnr] = [await seqnrOf(pos, left[pos]), await seqnrOf(pos, right[pos])];
        test.eq([heads[pos] + 1, heads[pos] + 2], [leftSeqnr, rightSeqnr].toSorted((lhs, rhs) => lhs! - rhs!));
        return leftSeqnr! < rightSeqnr!;
      }));
      test.eq(order[0], order[1], "The work that committed first must come first in every schema it touched");
    }
  } finally {
    await runInWork(async () => {
      for (const id of schemaIds)
        await deleteSchema(id);
    });
  }
}

test.runTests([
  testHistoryDisabled,
  testDeletesAndHead,
  testConcurrentHeadNumbering,
]);
