import type { FSObjectPolicy, FSObjectPolicyBaseContext } from "@webhare/backend-integration";
import { openFile } from "@webhare/whfs";

export const schedulingDefaultsPolicy: FSObjectPolicy = {
  getPublicationDefaults: async (context: FSObjectPolicyBaseContext) => {
    //validate that targetObject is a 'proper' file, not historic
    await openFile(context.targetObject);

    const content = await openFile(context.contentObject, { allowHistoric: true });

    if (content.title.match(/^\d{4}-\d{2}-\d{2}/)) {
      return {
        start: Temporal.Instant.from(content.title),
        end: Temporal.Instant.from(content.title).add({ hours: 36 })
      };
    }

    return null;
  }
};
