let completed = 0;

export function reset() { completed = 0; return status(); }
export function status() { return { pid: process.pid, completed }; }

export async function work(token: number, detached: boolean) {
  try {
    if (token === 1 && detached)
      setTimeout(() => { void Promise.reject(new Error("synthetic detached rejection")); }, 10);
    await new Promise(resolve => setTimeout(resolve, token === 1 ? 25 : 50));
    if (token === 1 && !detached) throw new Error("synthetic returned rejection");
    return { token, pid: process.pid };
  } finally { ++completed; }
}
