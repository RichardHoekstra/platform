import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { runCli } from "@webhare/cli";
import { beginWork, commitWork, db } from "@webhare/whdb";
import { wrd, type WRDInsertable, type WRDSchemaLike } from "@webhare/wrd";

runCli({
  async main() {
    const configSchema = wrd("system:config");
    await beginWork();
    /* keytype: 0 = maps, 1 = recaptcha
      scopetype: 0 = any scope. 1 = use in clients (javascript), 2 = use in servers
      */

    const inkeys = await db<PlatformDB>().selectFrom("socialite.google_apikeys").selectAll().execute();

    keyLoop:
    for (const key of inkeys) {
      if (key.domain.endsWith(".testframework.beta.webhare.net"))
        continue keyLoop; // do not import testframework keys

      const outKey: WRDInsertable<WRDSchemaLike["system:config"]["apiSecret"]> = {
        wrdCreated: key.creationdate.getTime() <= 0 ? new Date : key.creationdate,
        masks: key.domain === "*" ? "*" : `https://${key.domain}/*`,
        apiType: "",
        comment: key.comment
      };

      switch (key.keytype) {
        case 0: ///maps
          outKey.apiType = key.scopetype === 1 ? "platform:google.cloud.frontend" : "platform:google.cloud.backend";
          outKey.secret = { apiKey: key.apikey };
          break;
        case 1: //recaptcha
          outKey.apiType = "platform:google.recaptcha";
          outKey.secret = { siteKey: key.apikey, apiKey: key.privatekey };
          break;
        case 2: //friendlycaptcha
          outKey.apiType = "platform:friendlycaptcha";
          outKey.secret = { siteKey: key.apikey, apiKey: key.privatekey };
          break;
        default:
          //Ignore. If this happens we'll hear about it eventually
          continue keyLoop;
      }

      await configSchema.insert("apiSecret", outKey);
      if (key.keytype === 0 && key.scopetype === 0) //both frontend and backend? we've already inserted backend
        await configSchema.insert("apiSecret", { ...outKey, apiType: "platform:google.cloud.frontend" }); //insert a second copy for frontend
      await db<PlatformDB>().deleteFrom("socialite.google_apikeys").where("id", "=", key.id).execute();
    }
    // console.table(await configSchema.query("apiSecret").select(["apiType", "masks", "secret", "wrdCreated", "comment"]).execute());
    await commitWork();
  }
});
