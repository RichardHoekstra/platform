import { getTypedArray, HareScriptType } from "@webhare/hscompat/src/hson";
import { emplace } from "@webhare/std";
import { type FinishHandler, broadcastOnCommit, db, sql } from "@webhare/whdb";
import { finishHandlerFactory } from "@webhare/whdb/src/impl";


class WRDFinishHandler implements FinishHandler {
  linkCheckedSettings = new Set<number>;
  /// Map from wrdschema id to changeset id
  autoChangeSets = new Map<number, number>;
  /// All changesets created in this work, to be numbered in commit order
  changeSets: Array<{ wrdSchemaId: number; changeSetId: number }> = [];
  /// Source description recorded with every change written in this work
  changeSource: Record<string, unknown> | null = null;
  typeChanges = new Map<number, {
    type: number;
    created?: Set<number>;
    updated?: Set<number>;
    deleted?: Set<number>;
    num: number;
    allinvalidated?: boolean;
  }>;
  schemaChanges = new Map<number, {
    metadata?: boolean;
    name?: boolean;
  }>;

  /* Advance the history head of every schema we created a changeset for, and number the changeset with the new head.
     Done in onAfterPrepare, so changesets created by another finish handler's onBeforeCommit are numbered too, and
     as late as possible: the update locks the schema row until commit, which is what serializes the numbering in
     commit order, so we want to hold that lock only for the duration of the actual commit. Always take the schema
     locks in ascending schema order, so two transactions touching the same schemas cannot deadlock by locking them
     in opposite orders. */
  async onAfterPrepare() {
    while (this.changeSets.length) {
      const pending = this.changeSets.toSorted((lhs, rhs) => lhs.wrdSchemaId - rhs.wrdSchemaId || lhs.changeSetId - rhs.changeSetId);
      this.changeSets = [];
      for (const { wrdSchemaId, changeSetId } of pending)
        await sql`WITH head AS (UPDATE wrd.schemas SET historyhead = historyhead + 1 WHERE id = ${wrdSchemaId} RETURNING historyhead)
                  UPDATE wrd.changesets SET historyseqnr = head.historyhead FROM head WHERE wrd.changesets.id = ${changeSetId}`.execute(db());
    }
  }

  onBeforeCommit() {
    this.autoChangeSets.clear();

    // schedule the broadcasts to take place before the commit handlers
    for (const typeRec of this.typeChanges.values()) {
      broadcastOnCommit(`wrd:type.${typeRec.type}.change`, {
        allinvalidated: typeRec.allinvalidated || false,
        created: getTypedArray(HareScriptType.IntegerArray, typeRec.allinvalidated ? [] : [...typeRec.created || []].sort()),
        updated: getTypedArray(HareScriptType.IntegerArray, typeRec.allinvalidated ? [] : [...typeRec.updated || []].sort()),
        deleted: getTypedArray(HareScriptType.IntegerArray, typeRec.allinvalidated ? [] : [...typeRec.deleted || []].sort()),
      });
    }

    let anyListChange = false;
    for (const [id, changes] of this.schemaChanges) {
      if (changes.metadata)
        broadcastOnCommit(`wrd:schema.${id}.change`, { metadatachanged: true });
      if (changes.name)
        anyListChange = true;
    }
    if (anyListChange)
      broadcastOnCommit(`wrd:schema.list`);
  }

  getTypeRecord(wrdTypeId: number) {
    let typeRec = this.typeChanges.get(wrdTypeId);
    if (!typeRec) {
      typeRec = {
        type: wrdTypeId,
        num: 0,
      };
      this.typeChanges.set(wrdTypeId, typeRec);
    }
    return typeRec;
  }

  entityChange(wrdSchemaId: number, wrdTypeId: number, entityId: number, type: "created" | "updated" | "deleted") {
    const typeRec = this.getTypeRecord(wrdTypeId);
    if (typeRec.allinvalidated)
      return;

    if (++typeRec.num > 500) {
      typeRec.allinvalidated = true;
      return;
    }

    (typeRec[type] ??= new Set).add(entityId);
  }

  schemaNameChanged(wrdSchemaId: number) {
    const changes = emplace(this.schemaChanges, wrdSchemaId, { insert: () => ({}) });
    changes.metadata = true;
    changes.name = true;
  }

  schemaMetadataChanged(wrdSchemaId: number) {
    const changes = emplace(this.schemaChanges, wrdSchemaId, { insert: () => ({}) });
    changes.metadata = true;
  }

  entityCreated(wrdSchemaId: number, wrdTypeId: number, entityId: number): void {
    this.entityChange(wrdSchemaId, wrdTypeId, entityId, "created");
  }

  entityUpdated(wrdSchemaId: number, wrdTypeId: number, entityId: number): void {
    this.entityChange(wrdSchemaId, wrdTypeId, entityId, "updated");
  }

  entityDeleted(wrdSchemaId: number, wrdTypeId: number, entityId: number): void {
    this.entityChange(wrdSchemaId, wrdTypeId, entityId, "deleted");
  }

  addLinkCheckedSettings(settingids: number[]): void {
    for (const id of settingids)
      this.linkCheckedSettings.add(id);
  }

  getAutoChangeSet(wrdSchemaId: number): number | null {
    return this.autoChangeSets.get(wrdSchemaId) ?? null;
  }

  setAutoChangeSet(wrdSchemaId: number, changeSetId: number): void {
    this.autoChangeSets.set(wrdSchemaId, changeSetId);
  }

  changeSetCreated(wrdSchemaId: number, changeSetId: number): void {
    this.changeSets.push({ wrdSchemaId, changeSetId });
  }

  setChangeSource(source: Record<string, unknown> | null): void {
    this.changeSource = source;
  }

  getChangeSource(): Record<string, unknown> | null {
    return this.changeSource;
  }
}

export const wrdFinishHandler = finishHandlerFactory(WRDFinishHandler);
