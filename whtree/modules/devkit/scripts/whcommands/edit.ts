// @webhare/cli: Open a file in a connected editor

import { resolve } from "node:path";
import { CLIRuntimeError, runCli } from "@webhare/cli";
import { isAbsoluteResource, openBackendService, toFSPath } from "@webhare/services";

runCli({
  description: "Open a file in a connected editor",
  arguments: [{ name: "<path>", description: "Filesystem or WebHare resource path to open" }],
  async main({ args }) {
    const resource = isAbsoluteResource(args.path) ? toFSPath(args.path) : resolve(args.path);

    await using service = await openBackendService("devkit:lspservice", undefined, { linger: false, timeout: 5000 });
    const result = await service.showResource({ resource });
    if (!result)
      throw new CLIRuntimeError("No connected editor is available to open the file");
  }
});
