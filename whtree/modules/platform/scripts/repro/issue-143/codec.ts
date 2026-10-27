import { runCli } from "@webhare/cli";
import { BackendServiceConnection, openBackendService, runBackendService, WebHareBlob } from "@webhare/services";
import { getFullConfigFile } from "@mod-system/js/internal/configuration";
import { Money, isBlob, stdTypeOf } from "@webhare/std";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";

const execute = promisify(execFile);
const payload = "socket parity blob: \u00e9\ud83d\ude42";
let diskPath = "";

class ParityService extends BackendServiceConnection {
  async describe(value: unknown) {
    const type = stdTypeOf(value);
    if (isBlob(value)) {
      return { kind: type, size: value.size, text: await value.text(), path: "path" in value ? String(value.path) : "" };
    }
    return { kind: type, representation: type === "Date" ? (value as Date).toISOString() : String(value) };
  }
  echo(value: unknown) { return value; }
  async getPayload(kind: string) {
    if (kind === "disk") return await WebHareBlob.fromDisk(diskPath);
    if (kind === "native") return new Blob([payload], { type: "text/plain" });
    return WebHareBlob.from(payload);
  }
  getBigInt() { return 9007199254740993n; }
  throwExample() { throw new Error("Parity probe error"); }
}

function received(value: unknown) {
  return { kind: stdTypeOf(value), hasBlobMethods: isBlob(value), keys: value && typeof value === "object" ? Object.keys(value) : [], representation: typeof value === "bigint" ? value.toString() : undefined };
}

runCli({ async main() {
  const directory = await mkdtemp("/tmp/wh-unix-parity-");
  diskPath = join(directory, "payload.txt");
  await writeFile(diskPath, payload);
  const name = `platform:parityprobe_${process.pid}`;
  const socketPath = getFullConfigFile().socketDir + name;
  const service = await runBackendService(name, () => new ParityService(), { protocols: ["bridge", "unix-socket"] });
  const tsResults: unknown[] = [];
  try {
    for (const protocol of ["bridge", "unix-socket"] as const) {
      const client = await openBackendService<ParityService>(name, [], { protocol, linger: true, notOnDemand: true, timeout: 2000 });
      try {
        for (const [label, value] of [
          ["string", "hello \u00e9\ud83d\ude42"], ["money", new Money("12.34567")],
          ["date", new Date("2026-10-27T12:34:56.789Z")], ["bigint", 9007199254740993n],
          ["memory-blob", WebHareBlob.from(payload)], ["disk-blob", await WebHareBlob.fromDisk(diskPath)],
          ["native-blob", new Blob([payload])],
        ] as const) {
          const description = await client.describe(value);
          tsResults.push({ protocol, direction: "argument", label, description });
        }
        for (const kind of ["memory", "disk", "native"]) {
          const result = await client.getPayload(kind);
          tsResults.push({ protocol, direction: "result", label: kind + "-blob", received: received(result) });
        }
        const bigint = await client.getBigInt();
        assert.equal(bigint, 9007199254740993n);
        tsResults.push({ protocol, direction: "result", label: "bigint", received: received(bigint) });
      } finally { client.close(); }
    }
    console.log("TS_PARITY", JSON.stringify(tsResults));
    console.log("SOCKET_SETUP", JSON.stringify({ socketPath, isSocket: (await stat(socketPath)).isSocket(), directory }));
    const guard = await openBackendService<ParityService>(name, [], { protocol: "unix-socket", linger: true, notOnDemand: true, timeout: 2000 });
    console.log("FRESH_UNIX_CONTROL", JSON.stringify(await guard.describe("fresh connection before HS")));
    guard.close();
    const hs = await execute("wh", ["run", "mod::platform/scripts/repro/issue-143/codec-client.whscr", name, socketPath, diskPath], { timeout: 30000, maxBuffer: 1024 * 1024 });
    process.stdout.write(hs.stdout);
    if (hs.stderr) process.stderr.write(hs.stderr);
    const line = hs.stdout.split("\n").find(value => value.startsWith("HS_PARITY "));
    assert(line, "Native HS probe must produce a result");
    const native = JSON.parse(line.slice("HS_PARITY ".length));
    assert.equal(native.wasm, false);
    assert.equal(native.native_socket_connected, true);
    assert.equal(native.unix_constructor_has_methods, false);
    const cases = Object.fromEntries(native.cases.map((entry: { label: string }) => [entry.label, entry]));
    for (const label of ["string", "money", "date"]) assert.deepEqual(cases[label].ipc, cases[label].unix);
    assert.deepEqual(cases.integer64.ipc, { kind: "bigint", representation: "9007199254740993" });
    assert.deepEqual(cases.integer64.unix, { kind: "number", representation: "9007199254740992" });
    for (const label of ["memory-blob", "disk-blob"]) {
      assert.equal(cases[label].ipc.kind, "Blob");
      assert.equal(cases[label].unix.kind, "string");
    }
    assert.equal(native.ipc_bigint, "9007199254740993");
    assert.equal(native.ipc_blob_text, payload);
    assert.equal(native.unix_blob_result_type, "RECORD");
    assert.equal(native.unix_bigint_decode_error, 'Unsupported $stdType "bigint"');
    console.log("PARITY_RESULT", JSON.stringify({ ts: tsResults, native, implementationPatched: false }));
  } finally {
    service.close();
    await rm(directory, { recursive: true, force: true });
  }
} });
