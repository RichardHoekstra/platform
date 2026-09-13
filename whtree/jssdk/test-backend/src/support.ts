import { encryptForThisServer } from "@webhare/services";

export function generateTestPageToken(): string {
  return encryptForThisServer("platform:testpagetoken", { expires: new Date(Date.now() + 60 * 68 * 1000) });
}
