import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { whconstant_historytype_autosave, whconstant_whfsid_whfs_snapshots } from "@mod-system/js/internal/webhareconstants";
import { readRegistryKey } from "@webhare/services";
import { beginWork, commitWork, db, rollbackWork } from "@webhare/whdb";
import { selectFSWHFSPath } from "@webhare/whdb/src/functions";

export async function doRemoveObsoleteDrafts(): Promise<boolean> {
  await beginWork();

  //We'll take the trashcan expiry limit for autosave ('private draft') too
  const maxRecycleDays = await readRegistryKey("publisher:trashcan.trashcanexpire");
  const cutoff = new Date(Date.now() - maxRecycleDays * 24 * 60 * 60 * 1000);

  const oldAutosaves = await db<PlatformDB>().selectFrom("system.fs_history")
    .select("snapshot")
    .where("type", "=", whconstant_historytype_autosave)
    .where("when", "<", cutoff) //this part was commented out in HS too, leaving it so during refactor
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

    await db<PlatformDB>().deleteFrom("system.fs_objects")
      .where("id", "in", snapshotIds)
      .execute();
  }

  await commitWork();
  return true;
}
