import { isSafeObjectEntry } from "@webhare/std";

/** Apply an OpenAPI overlay in place, preserving unspecified keys and merging arrays by index.
 * Shared by type generation and runtime service initialization, including the served specification.
 */
export function mergeIntoBundled(data: unknown, merge: unknown, path: string) {
  if (typeof merge !== "object" || !merge || typeof data !== "object" || !data)
    throw new Error(`Cannot merge a non-object into an object`);

  if (Array.isArray(data) !== Array.isArray(merge))
    throw new Error(`Cannot merge array into object or vice versa`);

  for (const [key, value] of Object.entries(merge).filter(isSafeObjectEntry)) {
    const datavalue = (data as Record<typeof key, unknown>)[key];
    if (typeof value !== "object" || !value)
      (data as Record<typeof key, unknown>)[key] = value;
    else if (typeof datavalue !== "object" || !datavalue)
      (data as Record<typeof key, unknown>)[key] = value;
    else
      mergeIntoBundled((data as Record<typeof key, unknown>)[key], value, `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`);
  }
}
