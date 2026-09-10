import type { FSObjectPolicy, FSObjectPolicyBaseContext } from "@webhare/backend-integration";

export const seoPolicy: FSObjectPolicy = {
  getFallbackMetaTitle: (context: FSObjectPolicyBaseContext) => {
    return context.title === "default" ? null : context.title ? context.title + " - Home" : "Initial placeholder title";
  }
};
