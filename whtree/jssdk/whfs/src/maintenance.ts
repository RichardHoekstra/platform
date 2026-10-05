import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { whconstant_historytype_abandoned_autosave, whconstant_historytype_autosave, whconstant_whfsid_whfs_snapshots } from "@mod-system/js/internal/webhareconstants";
import { readRegistryKey } from "@webhare/services";
import { beginWork, commitWork, db, rollbackWork } from "@webhare/whdb";
import { selectFSWHFSPath } from "@webhare/whdb/src/functions";

/** Cleanup old autosaves
 * @param options.maxRecycleDays - Override configured trashcan expiry limit
 * @param options.fsObjects - Only cleanup autosaves for these file system objects (used for tests)
 */
export async function doRemoveObsoleteDrafts(options?: {
  maxRecycleDays?: number;
  fsObjects?: number[];
}): Promise<boolean> {
  await beginWork();

  const maxRecycleDays = options?.maxRecycleDays ?? await readRegistryKey("publisher:trashcan.trashcanexpire");
  //We'll take the trashcan expiry limit for autosave ('private draft') too
  const cutoff = new Date(Date.now() - maxRecycleDays * 24 * 60 * 60 * 1000);

  const oldAutosaves = await db<PlatformDB>().selectFrom("system.fs_history")
    .select("snapshot")
    .where("type", "=", whconstant_historytype_autosave)
    .where("when", "<", cutoff) //this part was commented out in HS too, leaving it so during refactor
    .$if(Boolean(options?.fsObjects), qb => qb.where("fs_object", "in", options!.fsObjects!))
    .execute();

  const snapshotIds = oldAutosaves.map(autosave => autosave.snapshot);
  if (snapshotIds.length) {
    const sharedSnapshots = await db<PlatformDB>().selectFrom("system.fs_history")
      .select(["id", "snapshot", "type", "when"])
      .where("type", "!=", whconstant_historytype_autosave)
      .where("snapshot", "in", snapshotIds)
      .execute();

    if (sharedSnapshots.length) {
      console.error("Unexpected deletable autosave history items are sharing snapshots with items we want to keep - this should not happen");
      console.table(sharedSnapshots);
      await rollbackWork();
      return false;
    }

    const snapshotFolders = db<PlatformDB>().selectFrom("system.fs_objects")
      .select("id")
      .where("parent", "=", whconstant_whfsid_whfs_snapshots)
      .where("isfolder", "=", true);

    const misplacedSnapshots = await db<PlatformDB>().selectFrom("system.fs_objects")
      .select("id")
      .select(selectFSWHFSPath().as("whfspath"))
      .where("id", "in", snapshotIds)
      .where("parent", "not in", snapshotFolders)
      .execute();

    if (misplacedSnapshots.length) {
      console.error("Unexpected deletable autosave history items are not in the snapshots folder - this should not happen");
      console.table(misplacedSnapshots);
      await rollbackWork();
      return false;
    }

    //Now we're satisfied the snapshots aren't (ab)used, delete the snapshots and their corresponding autosave history entries
    await db<PlatformDB>().deleteFrom("system.fs_objects")
      .where("id", "in", snapshotIds)
      .execute();

    await db<PlatformDB>().deleteFrom("system.fs_history")
      .where("type", "in", [whconstant_historytype_autosave, whconstant_historytype_abandoned_autosave])
      .where("when", "<", cutoff) //this part was commented out in HS too, leaving it so during refactor
      .$if(Boolean(options?.fsObjects), qb => qb.where("fs_object", "in", options!.fsObjects!))
      .execute();
  }

  await commitWork();
  return true;
}
