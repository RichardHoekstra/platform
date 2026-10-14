import { getAuditEvents } from "@webhare/auth";
import { IdentityProvider } from "@webhare/auth/src/identity";
import type { RPCContext } from "@webhare/router";
import type { FlexibleInstant } from "@webhare/std";
import { beginWork, commitWork, runInWork } from "@webhare/whdb";
import { AuthenticationSettings, updateSchemaSettings, wrd, type WRDSchemaLike, type WRDUpdatable } from "@webhare/wrd";

const jsAuthSchema = wrd<WRDSchemaLike["webhare_testsuite:jsschema"]>("webhare_testsuite:testschema");

export const authTestSupportRPC = {
  async prepHIBP(context: RPCContext) {
    await beginWork();
    await updateSchemaSettings(jsAuthSchema, { passwordValidationChecks: "hibp" });
    const testuser = await jsAuthSchema.find("wrdPerson", { wrdContactEmail: "pietje-authpages-js@beta.webhare.net" });
    await jsAuthSchema.update("wrdPerson", testuser!, { password: AuthenticationSettings.fromPasswordHash("PLAIN:secret") });
    await commitWork();
  },
  async prepResetPassword(context: RPCContext, targetUrl: string, options?: { codePrefix?: string }) {
    const testuser = await jsAuthSchema.find("wrdPerson", { wrdContactEmail: "pietje-authpages-js@beta.webhare.net" });
    return new IdentityProvider(jsAuthSchema).createPasswordResetLink(targetUrl, testuser!, {
      separateCode: Boolean(options?.codePrefix),
      prefix: options?.codePrefix || ""
    });
  },
  async getUserInfo(context: RPCContext, email: string) {
    const testSchema = wrd("wrd:testschema");
    //TODO tests using this should move over to webhare_testsuite:testschema
    const testuser = await testSchema.find("wrdPerson", { wrdContactEmail: email });
    if (!testuser)
      return null;

    return testSchema.getFields("wrdPerson", testuser, ["wrdFirstName", "wrdLastName", "wrdContactEmail", "whuserLastlogin"]);
  },
  async getAuditEvents(context: RPCContext, filter: { userEmail?: string; since?: FlexibleInstant }) {
    let user: number | undefined;
    if (filter.userEmail) {
      user = await jsAuthSchema.find("wrdPerson", { wrdContactEmail: filter.userEmail }) || undefined;
      if (!user)
        throw new Error(`User with email ${filter.userEmail} not found`);
    }

    return await getAuditEvents(jsAuthSchema, { user, since: filter.since });
  },
  async updateSchemaSettings(context: RPCContext, settings: WRDUpdatable<WRDSchemaLike["webhare_testsuite:jsschema"]["wrdSettings"]>): Promise<void> {
    if (settings)
      await runInWork(() => updateSchemaSettings(jsAuthSchema, settings));
  }
};
