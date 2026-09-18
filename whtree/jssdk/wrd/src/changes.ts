import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { db, nextVal, sql } from "@webhare/whdb";
import type { Expression } from "kysely";
import { type EntityPartialRec, type EntityRec, type EntitySettingsRec, type SchemaData, type TypeRec, selectEntitySettingColumns, selectEntitySettingWHFSLinkColumns } from "./db";
import { omit } from "@webhare/std";
import { setHareScriptType, type IPCMarshallableData, HareScriptType, getTypedArray, encodeHSON } from "@webhare/hscompat/src/hson";
import { getScopedResource } from "@webhare/services/src/codecontexts";
import type { AuthAuditContext } from "@webhare/auth";
import { encodeWRDGuid, getIdToGuidMap } from "./accessors";
import { wrdFinishHandler } from "./finishhandler";
import { prepareAnyForDatabase } from "@webhare/whdb/src/formats";
import { debugFlags } from "@webhare/env/src/envbackend";
import { maxDateTimeTotalMsecs } from "@webhare/hscompat/src/datetime";
import { getStackTrace } from "@webhare/js-api-tools";


export type ChangesSettings<T extends string | number | null> = Array<Omit<EntitySettingsRec, "blobdata" | "entity" | "setting" | "attribute"> & { blobseqnr: number; setting: T; attribute: T }>;
export type ChangesWHFSLinks = Array<{ id: number; linktype: number; data: IPCMarshallableData }>;
export type Changes<T extends string | number | null> = {
  entity?: T;
  oldsettings: {
    entityrec: Omit<EntityRec, "leftentity" | "rightentity" | "guid"> & { leftentity: T; rightentity: T; guid: string } | null;
    settings: ChangesSettings<T>;
    whfslinks: ChangesWHFSLinks;
  };
  modifications: {
    entityrec: Omit<EntityPartialRec, "leftentity" | "rightentity" | "guid"> & { leftentity?: T; rightentity?: T; guid?: string };
    settings: ChangesSettings<T>;
    whfslinks: ChangesWHFSLinks;
    deletedsettings: number[];
    /** Set if this change records the deletion of the entity. All settings in oldsettings are then in deletedsettings */
    deleted?: true;
    /** Set if the old settings held WHFS backed values (rich text, instances, file references) that this
        implementation cannot record, so their absence from oldsettings.whfslinks is not proof they were empty */
    whfslinksmissing?: true;
  };
};

export function serializeChangeEntity<T>(entity: T & { guid: Buffer }): Omit<T, "guid"> & { guid: string };
export function serializeChangeEntity<T>(entity: T & { guid?: Buffer }): Omit<T, "guid"> & { guid?: string };

export function serializeChangeEntity<T>(entity: T & { guid?: Buffer }): Omit<T, "guid"> & { guid?: string } {
  if ("guid" in entity)
    return { ...entity, guid: encodeWRDGuid(entity.guid!) };
  else //@ts-expect-error We know guid is not in entity
    return entity;
}

/** Describe the user making the changes. The HareScript API stores GetUserDataForLogging() here; we can only fill in
    what the audit context knows, so a change made outside a Tollium session has no realname and the changes screen
    falls back to showing the login name. */
function getActingUser(): { entity: Expression<number | null> | null; userdata: string } {
  // The audit context is maintained by @webhare/auth (which depends on us, so we read its scoped resource directly)
  const context = getScopedResource<AuthAuditContext>("platform:authcontext");
  if (!context?.actionBy)
    return { entity: null, userdata: "" };
  return {
    /* Look the user up instead of referring to it directly: the context may still name an entity that has since been
       deleted, and changesets.entity is a foreign key, so a stale context would abort the whole transaction on commit.
       The description below keeps the identity we were given either way. */
    entity: sql<number | null>`(SELECT id FROM wrd.entities WHERE id = ${context.actionBy})`,
    userdata: encodeHSON({
      ...(context.actionByLogin ? { login: context.actionByLogin } : null),
      ...(context.impersonatedByLogin ? { impersonator_login: context.impersonatedByLogin } : null),
    })
  };
}

/** Get the source data to record with a change: the source set for this work, plus a stack trace when debugging history */
export function getChangeSourceData(): Record<string, unknown> | null {
  const source = wrdFinishHandler().getChangeSource();
  const stacktrace = debugFlags["wrd:forcehistory"] ? { stacktrace: getStackTrace() } : null;
  return source || stacktrace ? { ...stacktrace, ...source } : null;
}

export async function createChangeSet(wrdSchemaId: number, now: Date): Promise<number> {
  const retval = await db<PlatformDB>()
    .insertInto("wrd.changesets")
    .values({
      creationdate: now,
      wrdschema: wrdSchemaId,
      ...getActingUser(),
      historyseqnr: 0, // numbered just before commit
    })
    .returning(["id"])
    .execute();
  wrdFinishHandler().changeSetCreated(wrdSchemaId, retval[0].id);
  return retval[0].id;
}

/** Get the changeset to record changes in: the changeset automatically created for this schema in the current work, creating it if needed */
export async function getAutoChangeSet(wrdSchemaId: number, now: Date): Promise<number> {
  let changeset = wrdFinishHandler().getAutoChangeSet(wrdSchemaId);
  if (!changeset) {
    changeset = await createChangeSet(wrdSchemaId, now);
    wrdFinishHandler().setAutoChangeSet(wrdSchemaId, changeset);
  }
  return changeset;
}

export async function saveEntitySettingAttachments(changeid: number, settings: EntitySettingsRec[]): Promise<ChangesSettings<number | null>> {
  const retval: ChangesSettings<number | null> = [];
  for (const setting of settings) {
    let attachid = 0;
    if (setting.blobdata) {
      attachid = await nextVal("wrd.change_attachments.id");
      await db<PlatformDB>()
        .insertInto("wrd.change_attachments")
        .values({
          id: attachid,
          change: changeid,
          data: setting.blobdata,
          seqnr: attachid
        })
        .execute();
    }
    retval.push({
      ...omit(setting, ["blobdata", "entity"]),
      blobseqnr: attachid
    });
  }
  return retval;
}

export async function getWHFSLinksForChanges(ids: number[]): Promise<ChangesWHFSLinks> {
  const links = await db<PlatformDB>()
    .selectFrom("wrd.entity_settings_whfslink")
    .select(selectEntitySettingWHFSLinkColumns)
    .where("id", "in", ids)
    .orderBy("id")
    .execute();

  const retval: ChangesWHFSLinks = [];

  //OBJECT whfs_mapper := NEW WHFSResourceNameMapper;
  for (const link of links) {
    switch (link.linktype) {
      case 0: { // RTD
        throw new Error(`Recording WHFS RTDs in changesets is not supported yet`);
        /*
        retval.push({
          id:link.id,
          linktype: link.linktype,
          data: retrieveRTDInWHFS(link.id, whfs_mapper)
        }); */
      } break;
      case 1: { // instance data
        throw new Error(`Recording WHFS instances in changesets is not supported yet`);
        /*
        retval.push({
          id:link.id,
          linktype: link.linktype,
          data: retrieveInstanceInWHFS(link.id, whfs_mapper)
        });
        */
      } break;
      case 2: { // FS object
        throw new Error(`Recording WHFS links in changesets is not supported yet`);
        /*
        retval.push({
          id:link.id,
          linktype: link.linktype,
          data: whfs_mapper.mapWHFSRef(link.fsobject)
        });
        */
      } break;
    }
  }
  return retval;
}

// Gathers all entity referenecs from a changes record
function gatherEntitiesFromChanges<T extends number | string | null>(changes: Changes<T>): T[] {
  const retval = new Array<T>;
  for (const rec of [...changes.oldsettings.settings, ...changes.modifications.settings]) {
    if (rec.setting)
      retval.push(rec.setting);
  }
  if (changes.oldsettings.entityrec?.leftentity)
    retval.push(changes.oldsettings.entityrec.leftentity);
  if (changes.oldsettings.entityrec?.rightentity)
    retval.push(changes.oldsettings.entityrec.rightentity);
  if (changes.modifications.entityrec.leftentity)
    retval.push(changes.modifications.entityrec.leftentity);
  if (changes.modifications.entityrec.rightentity)
    retval.push(changes.modifications.entityrec.rightentity);
  return retval;
}

function mapChangesRefs<A extends number | string | null, B extends number | string | null>(changes: Changes<A>, attributeMapping: Map<A, B>, settingMapping: Map<A, B>, defaultValue: B): Changes<B> {
  const retval: Changes<B> = {
    ...("entity" in changes ? { entity: (changes.entity && settingMapping.get(changes.entity)) || defaultValue } : null),
    oldsettings: {
      entityrec: changes.oldsettings.entityrec && {
        ...changes.oldsettings.entityrec,
        leftentity: changes.oldsettings.entityrec.leftentity && settingMapping.get(changes.oldsettings.entityrec.leftentity) || defaultValue,
        rightentity: changes.oldsettings.entityrec.rightentity && settingMapping.get(changes.oldsettings.entityrec.rightentity) || defaultValue,
      },
      settings: changes.oldsettings.settings.map(setting => ({
        ...setting,
        setting: setting.setting && settingMapping.get(setting.setting) || defaultValue,
        attribute: setting.attribute && attributeMapping.get(setting.attribute) || defaultValue,
      })),
      whfslinks: changes.oldsettings.whfslinks,
    },
    modifications: {
      entityrec: {
        ...omit(changes.modifications.entityrec, ["leftentity", "rightentity"]),
        ...("leftentity" in changes.modifications.entityrec ? { leftentity: changes.modifications.entityrec.leftentity && settingMapping.get(changes.modifications.entityrec.leftentity) || defaultValue } : null),
        ...("rightentity" in changes.modifications.entityrec ? { rightentity: changes.modifications.entityrec.rightentity && settingMapping.get(changes.modifications.entityrec.rightentity) || defaultValue } : null),
      },
      settings: changes.modifications.settings.map(setting => ({
        ...setting,
        setting: setting.setting && settingMapping.get(setting.setting) || defaultValue,
        attribute: setting.attribute && attributeMapping.get(setting.attribute) || defaultValue,
      })),
      whfslinks: changes.modifications.whfslinks,
      deletedsettings: changes.modifications.deletedsettings,
      ...(changes.modifications.deleted ? { deleted: true } : null),
      ...(changes.modifications.whfslinksmissing ? { whfslinksmissing: true } : null),
    }
  };

  setHareScriptType(retval.oldsettings.settings, HareScriptType.RecordArray);
  setHareScriptType(retval.oldsettings.whfslinks, HareScriptType.RecordArray);
  setHareScriptType(retval.modifications.settings, HareScriptType.RecordArray);
  setHareScriptType(retval.modifications.whfslinks, HareScriptType.RecordArray);
  setHareScriptType(retval.modifications.deletedsettings, HareScriptType.Integer64Array);

  return retval;
}

// Converts all types and entity references in a changes record to strings
export async function mapChangesIdsToRefs(typeRec: TypeRec, changes: Changes<number | null>): Promise<Changes<string>> {
  const ids = gatherEntitiesFromChanges(changes);
  const settingsMapping = await getIdToGuidMap(ids);
  return mapChangesRefs(changes, typeRec.attrHSNameMap, settingsMapping, "");
}

/** Record a change that only removes data from an entity: the deletion of the entity itself or the loss of settings
    @param cause - The change causing this change, if any
    @returns The id of the recorded change
*/
async function recordRemovalChange(typeRec: TypeRec, entityrec: EntityRec, settings: EntitySettingsRec[], removedSettingIds: number[], deleted: boolean, whfsLinked: boolean, cause: number | null, now: Date): Promise<number> {
  const changeId = await nextVal("wrd.changes.id");
  const changes: Changes<number | null> = {
    oldsettings: {
      entityrec: serializeChangeEntity(entityrec),
      settings: await saveEntitySettingAttachments(changeId, settings),
      whfslinks: [], //FIXME recording WHFS links is not supported yet (see getWHFSLinksForChanges), but that shouldn't block deletes
    },
    modifications: {
      entityrec: {},
      settings: [],
      whfslinks: [],
      deletedsettings: getTypedArray(HareScriptType.IntegerArray, removedSettingIds),
      ...(deleted ? { deleted: true } : null),
      ...(whfsLinked ? { whfslinksmissing: true } : null),
    }
  };

  const changedAttrs = new Set<string>;
  for (const setting of settings)
    if (removedSettingIds.includes(setting.id)) {
      const rootAttr = typeRec.attrRootAttrMap.get(setting.attribute);
      if (rootAttr)
        changedAttrs.add(rootAttr.tag);
    }

  const mappedChanges = await mapChangesIdsToRefs(typeRec, changes); //Convert ids to guids / attribute tags
  const { data: oldsettings, datablob: oldsettings_blob } = await prepareAnyForDatabase(mappedChanges.oldsettings);
  const { data: modifications, datablob: modifications_blob } = await prepareAnyForDatabase(mappedChanges.modifications);
  const { data: source, datablob: source_blob } = await prepareAnyForDatabase(getChangeSourceData());
  const changeset = await getAutoChangeSet(typeRec.schemaId, now);

  await db<PlatformDB>()
    .insertInto("wrd.changes")
    .values({
      id: changeId,
      creationdate: now,
      changeset,
      type: typeRec.id,
      entity: entityrec.guid,
      cause,
      oldsettings,
      oldsettings_blob,
      modifications,
      modifications_blob,
      source,
      source_blob,
      summary: [...changedAttrs].sort().join(","),
    })
    .execute();
  return changeId;
}

/** Record the deletion of entities in the history of the types that keep history, including the effects the database
    will cascade from it: attachments and links to the deleted entities are deleted too, and settings of other entities
    referring to the deleted entities are dropped. Every recorded effect refers to the recorded deletion that caused it.

    Must be called before the entities are actually deleted, inside the work that deletes them. Does nothing (and
    doesn't touch the database) if no type in the schema keeps history.

    The HareScript WRD API has its own copy of this logic (WRDTypeBase::__RecordEntityDeletion), keep them in sync.

    @param schemadata - Schema data of the schema being modified
    @param ids - Entities that are about to be deleted
    @param now - Timestamp for the recorded changes
*/
export async function recordEntityDeletion(schemadata: SchemaData, ids: number[], now: Date): Promise<void> {
  const historyDebugging = debugFlags["wrd:forcehistory"];
  const keepsHistory = (typeRec: TypeRec | undefined) => Boolean(typeRec && (typeRec.keephistorydays > 0 || historyDebugging));
  if (!ids.length || ![...schemadata.typeIdMap.values()].some(keepsHistory))
    return;

  /* Gather all entities that will disappear: the requested ones plus, transitively, the links and attachments pointing
     to them. Insertion order is the causal order: every entity follows the entity whose deletion cascades to it */
  const doomed = new Map<number, { rec: EntityRec; parent: number | null }>;
  for (const rec of await db<PlatformDB>().selectFrom("wrd.entities").selectAll().where("id", "in", ids).orderBy("id").execute())
    doomed.set(rec.id, { rec, parent: null });

  for (let frontier = [...doomed.keys()]; frontier.length;) {
    const cascaded = await db<PlatformDB>()
      .selectFrom("wrd.entities")
      .selectAll()
      .where(eb => eb.or([eb("leftentity", "in", frontier), eb("rightentity", "in", frontier)]))
      .where("id", "not in", [...doomed.keys()])
      .orderBy("id")
      .execute();
    const inFrontier = new Set(frontier);
    for (const rec of cascaded)
      doomed.set(rec.id, { rec, parent: rec.leftentity && inFrontier.has(rec.leftentity) ? rec.leftentity : rec.rightentity });
    frontier = cascaded.map(rec => rec.id);
  }
  if (!doomed.size)
    return;

  // Settings of surviving entities that refer to a doomed entity. The database will drop these (and their subsettings)
  const doomedIds = [...doomed.keys()];
  const droppedRefs = await db<PlatformDB>()
    .selectFrom("wrd.entity_settings")
    .select(["id", "entity", "setting"])
    .where("setting", "in", doomedIds)
    .where("entity", "not in", doomedIds)
    .orderBy("id")
    .execute();

  // The change recording the deletion of an entity, if its type keeps history. The cause of a cascaded effect is the nearest recorded deletion up the chain
  const deletionChanges = new Map<number, number>;
  const getCause = (entityId: number | null): number | null => {
    for (let id = entityId; id;) {
      const change = deletionChanges.get(id);
      if (change)
        return change;
      id = doomed.get(id)?.parent ?? null;
    }
    return null;
  };

  /* Read the settings of a group of entities in one query. Done in blocks so a bulk delete issues a few queries
     instead of one per entity, while keeping the settings (which carry the blobs) of only one block in memory. */
  const settingsPerBlock = 100;
  async function* inBlocks<T extends { id: number }>(entities: T[]): AsyncGenerator<Array<[T, EntitySettingsRec[], boolean]>> {
    for (let offset = 0; offset < entities.length; offset += settingsPerBlock) {
      const block = entities.slice(offset, offset + settingsPerBlock);
      const settings = await db<PlatformDB>()
        .selectFrom("wrd.entity_settings")
        .select(selectEntitySettingColumns)
        .where("entity", "in", block.map(entity => entity.id))
        .orderBy("id")
        .execute();
      /* We cannot record WHFS backed values yet (getWHFSLinksForChanges throws on them, which is why the update
         path refuses such entities), so note which entities had them instead of leaving their absence ambiguous */
      const whfsLinked = new Set(settings.length ? (await db<PlatformDB>()
        .selectFrom("wrd.entity_settings_whfslink")
        .innerJoin("wrd.entity_settings", "wrd.entity_settings.id", "wrd.entity_settings_whfslink.id")
        .select("wrd.entity_settings.entity")
        .where("wrd.entity_settings_whfslink.id", "in", settings.map(setting => setting.id))
        .execute()).map(row => row.entity) : []);
      const perEntity = Map.groupBy(settings, setting => setting.entity);
      yield block.map(entity => [entity, perEntity.get(entity.id) ?? [], whfsLinked.has(entity.id)]);
    }
  }

  /* Temporary entities never get history, the update path skips them too. They do stay in the closure, because
     whatever hangs off them still cascades and may well need recording. */
  const toRecord = [...doomed.values()].filter(victim =>
    keepsHistory(schemadata.typeIdMap.get(victim.rec.type)) && victim.rec.creationdate?.getTime() !== maxDateTimeTotalMsecs);
  for await (const block of inBlocks(toRecord.map(victim => victim.rec))) {
    for (const [rec, settings, whfsLinked] of block) {
      const parent = doomed.get(rec.id)!.parent;
      deletionChanges.set(rec.id, await recordRemovalChange(schemadata.typeIdMap.get(rec.type)!, rec, settings, settings.map(s => s.id), true, whfsLinked, getCause(parent), now));
    }
  }

  // Surviving entities that lose a reference. One lookup for all of them rather than one per entity.
  const refsPerEntity = Map.groupBy(droppedRefs, ref => ref.entity);
  const affected = refsPerEntity.size
    ? await db<PlatformDB>().selectFrom("wrd.entities").selectAll().where("id", "in", [...refsPerEntity.keys()]).orderBy("id").execute()
    : [];
  for await (const block of inBlocks(affected.filter(rec => keepsHistory(schemadata.typeIdMap.get(rec.type))))) {
    for (const [rec, settings, whfsLinked] of block) {
      const refs = refsPerEntity.get(rec.id)!;
      // The dropped settings and, transitively, their subsettings
      const removed = new Set(refs.map(ref => ref.id));
      for (let added = true; added;) {
        added = false;
        for (const setting of settings)
          if (setting.parentsetting && removed.has(setting.parentsetting) && !removed.has(setting.id)) {
            removed.add(setting.id);
            added = true;
          }
      }
      await recordRemovalChange(schemadata.typeIdMap.get(rec.type)!, rec, settings, [...removed].sort((a, b) => a - b), false, whfsLinked, getCause(refs[0].setting), now);
    }
  }
}
