import { WebHareMemoryBlob } from "@webhare/services/src/webhareblob";
import { spawn } from "child_process";

/** The TS helper for HS spawnProcessSync, hence the name. It's async but will be made sync in HareScript */
export async function spawnProcessSync(cmd: string, args: string[], options?: {
  stdin?: string;
  output_as_blob?: boolean;
  merge_stderr?: boolean;
}) {
  const stdout: Buffer[] = [], stderr: Buffer[] = [];
  const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });

  proc.stdout.on("data", chunk => stdout.push(Buffer.from(chunk)));
  if (options?.merge_stderr)
    proc.stderr.on("data", chunk => stdout.push(Buffer.from(chunk)));
  else
    proc.stderr.on("data", chunk => stderr.push(Buffer.from(chunk)));

  if (options?.stdin !== undefined)
    proc.stdin.end(options.stdin);
  else
    proc.stdin.end();

  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", (code, signal) => resolve({ code, signal }));
  });

  return {
    error: result.code !== 0,
    //node 24 lacks convertProcessSignalToExitCode so we'll just map signals to -1
    exitcode: result.code ?? -1,
    output: options?.output_as_blob ? WebHareMemoryBlob.from(Buffer.concat(stdout)) : Buffer.concat(stdout).toString("utf-8"),
    stderr: Buffer.concat(stderr).toString("utf-8"),
  };
}
