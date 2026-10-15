import { generateRandomId } from "@webhare/std";
import * as test from "@webhare/test";
import { getPasswordBreachCount } from "@webhare/auth/src/passwords";

// Queries the live HIBP API (api.pwnedpasswords.com), so this test is tagged 'external'
async function testPasswordBreachCount() {
  test.assert(await getPasswordBreachCount("a") > 700000);
  test.assert(await getPasswordBreachCount("secret") > 1000000);
  test.eq(0, await getPasswordBreachCount(generateRandomId()));
}

test.runTests([testPasswordBreachCount]);
