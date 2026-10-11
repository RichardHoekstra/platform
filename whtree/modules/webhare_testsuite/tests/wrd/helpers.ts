import type { WRDAuthAccountStatus } from "@webhare/auth";
import { isTemporalInstant, throwError } from "@webhare/std";
import * as test from "@webhare/test";
import { describeEntity, wrd, type WRDSchemaLike } from "@webhare/wrd";

export async function getAccountStatus(personId: number): Promise<WRDAuthAccountStatus> {
  const descr = await describeEntity(personId) ?? throwError("Failed to find entity #" + personId);
  const usermgmtSchema = wrd<WRDSchemaLike["system:usermgmt"]>(descr?.schema);
  const { wrdauthAccountStatus } = await usermgmtSchema.getFields("wrdPerson", personId, ["wrdauthAccountStatus"]);
  test.assert(isTemporalInstant(wrdauthAccountStatus.since), "wrdauthAccountStatus.since is not a Temporal.Instant");
  return wrdauthAccountStatus;
}
