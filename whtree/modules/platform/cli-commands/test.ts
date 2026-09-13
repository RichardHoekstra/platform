// @webhare/cli: Direct access to server session APIs

import { runCli } from "@webhare/cli";
import { generateTestPageToken } from "@webhare/test-backend/src/support";

runCli({
  flags: {
    "v,verbose": "Show more info",
  },
  subCommands: {
    "generate-token": {
      description: "Generate a testpage token",
      async main({ opts, args }) {
        console.log(generateTestPageToken());
      }
    }
  }
});
