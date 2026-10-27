import { runCli } from "@webhare/cli";
import { BackendServiceConnection, openBackendService, runBackendService } from "@webhare/services";
import { getFullConfigFile } from "@mod-system/js/internal/configuration";
import { stat } from "node:fs/promises";
import assert from "node:assert/strict";

class GenerationService extends BackendServiceConnection {
  private readonly generation: string;
  constructor(generation: string) { super(); this.generation = generation; }
  getGeneration() { return this.generation; }
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function exists(path: string) {
  try { await stat(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function waitUntilRemoved(path: string) {
  const deadline = Date.now() + 3000;
  while (await exists(path)) {
    assert(Date.now() < deadline, "Socket cleanup did not remove the published path");
    await delay(10);
  }
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Probe RPC timed out")), 3000);
    })]);
  } finally { clearTimeout(timer); }
}

const options = { protocol: "unix-socket" as const, timeout: 300, notOnDemand: true, linger: true };

async function baseline() {
  const name = `platform:handover_baseline_${process.pid}`;
  const path = getFullConfigFile().socketDir + name;
  const old = await runBackendService(name, () => new GenerationService("old"), { protocols: ["unix-socket"] });
  const oldClient = await openBackendService<GenerationService>(name, [], options);
  let replacement: Awaited<ReturnType<typeof runBackendService>> | undefined;
  let newClient: typeof oldClient | undefined;
  let oldClosed = false;
  try {
    assert.equal(await bounded(oldClient.getGeneration()), "old");
    old.close(); oldClosed = true;
    await waitUntilRemoved(path);
    replacement = await runBackendService(name, () => new GenerationService("new"), { protocols: ["unix-socket"] });
    newClient = await openBackendService<GenerationService>(name, [], options);
    const result = { oldConnectionAfterClose: await bounded(oldClient.getGeneration()), newConnectionAfterReplacement: await bounded(newClient.getGeneration()) };
    assert.deepEqual(result, { oldConnectionAfterClose: "old", newConnectionAfterReplacement: "new" });
    console.log("BASELINE", JSON.stringify(result));
    return result;
  } finally {
    oldClient.close(); newClient?.close();
    if (!oldClosed) old.close();
    replacement?.close();
    await waitUntilRemoved(path);
  }
}

async function overlap(iteration: number) {
  const name = `platform:handover_overlap_${process.pid}_${iteration}`;
  const path = getFullConfigFile().socketDir + name;
  const old = await runBackendService(name, () => new GenerationService("old"), { protocols: ["unix-socket"] });
  const oldClient = await openBackendService<GenerationService>(name, [], options);
  let replacement: Awaited<ReturnType<typeof runBackendService>> | undefined;
  let newClient: typeof oldClient | undefined;
  let unexpectedClient: typeof oldClient | undefined;
  let oldClosed = false;
  try {
    assert.equal(await bounded(oldClient.getGeneration()), "old");
    replacement = await runBackendService(name, () => new GenerationService("new"), { protocols: ["unix-socket"] });
    newClient = await openBackendService<GenerationService>(name, [], options);
    const before = { old: await bounded(oldClient.getGeneration()), new: await bounded(newClient.getGeneration()), pathExists: await exists(path) };
    assert.deepEqual(before, { old: "old", new: "new", pathExists: true });

    old.close(); oldClosed = true;
    await waitUntilRemoved(path);
    const after = { old: await bounded(oldClient.getGeneration()), new: await bounded(newClient.getGeneration()), pathExists: await exists(path) };
    assert.deepEqual(after, { old: "old", new: "new", pathExists: false });

    let newConnectionError = "";
    try { unexpectedClient = await openBackendService<GenerationService>(name, [], options); } catch (error) { newConnectionError = error instanceof Error ? error.message : String(error); }
    assert(!unexpectedClient, "A fresh connection unexpectedly reached the replacement after old cleanup");
    assert.match(newConnectionError, /is unavailable/);
    assert.equal(await bounded(newClient.getGeneration()), "new");
    const result = { iteration, before, after, newConnectionError };
    console.log("OVERLAP", JSON.stringify(result));
    return result;
  } finally {
    oldClient.close(); newClient?.close(); unexpectedClient?.close();
    if (!oldClosed) old.close();
    replacement?.close();
    await waitUntilRemoved(path);
  }
}

runCli({ async main() {
  const control = await baseline();
  const runs = [];
  for (let iteration = 1; iteration <= 3; ++iteration) runs.push(await overlap(iteration));
  console.log("HANDOVER_RESULT", JSON.stringify({ baseline: control, runs, reproduced: true }));
} });
