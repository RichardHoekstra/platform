import { runCli } from "@webhare/cli";
import { getFullConfigFile } from "@mod-system/js/internal/configuration";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

runCli({ async main() {
  const socketDir = getFullConfigFile().socketDir;
  if (!socketDir) throw new Error("This reproduction requires the native socket directory");
  const result = await promisify(execFile)("wh", ["run", "mod::platform/scripts/repro/issue-143/socket-calljs-client.whscr", socketDir], { timeout: 30000 });
  process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
} });
