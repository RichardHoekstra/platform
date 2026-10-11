import type { JWTPayload, OpenIdRequestParameters, ReportedUserInfo, AuthCustomizer, FrontendRequestParameters } from "@webhare/auth";
import { wrd, type WRDSchemaLike } from "@webhare/wrd";

export class TestAuthCustomizer implements AuthCustomizer {
  async onOpenIdToken(params: OpenIdRequestParameters, payload: JWTPayload): Promise<void> {
    //FIXME our IDP needs to fill email/profile fields itself if email & profile are requested AND permitted for that provider
    if (params.scopes.includes("testfw")) {
      const jsAuthSchema = wrd<WRDSchemaLike["webhare_testsuite:jsschema"]>("webhare_testsuite:testschema");
      const userinfo = await jsAuthSchema.getFields("wrdPerson", params.user, ["wrdFirstName", "wrdLastName", "wrdContactEmail"]);
      if (userinfo) {
        payload.testfw_firstname = userinfo.wrdFirstName;
        payload.testfw_lastname = userinfo.wrdLastName;
        payload.testfw_email = userinfo.wrdContactEmail;
      }
    }
  }

  onOpenIdReturn(_params: OpenIdRequestParameters) {
    return null;
  }
  onOpenIdUserInfo(_params: OpenIdRequestParameters, userinfo: ReportedUserInfo) {
    userinfo.answer = 43;
  }

  async onFrontendUserInfo(params: FrontendRequestParameters) {
    const testSchema = wrd("webhare_testsuite:testschema");
    if (params.wrdSchema.tag !== testSchema.tag)
      throw new Error(`Invalid schema - invoked for ${params.wrdSchema.tag} instead of ${testSchema.tag}`);
    const userinfo = await testSchema.getFields("wrdPerson", params.user, ["wrdFirstName"]);
    return { firstName: userinfo.wrdFirstName, aDate: new Date("2025-03-18") };
  }
}
