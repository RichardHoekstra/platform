// @webhare/cli: Manage registry keys

import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { CLIRuntimeError, runCli } from "@webhare/cli";
import { decodeHSON, determineType, encodeHSON, getHSTypeName, type IPCMarshallableData } from "@webhare/hscompat/src/hson";
import { createWebHarePasswordHash } from "@webhare/hscompat/src/passwords";
import { readRegistryKey, writeRegistryKey } from "@webhare/services";
import { db, runInWork } from "@webhare/whdb";

const registryKeyOptions = { acceptInvalidKeyNames: true };

function toRegistryKeyLikeMask(mask: string): string {
  // Storage uses a dot after the module; convert CLI syntax and escape SQL LIKE metacharacters.
  const storageMask = mask.replace(/^(<overrideuser>\.|<wrd:[a-f0-9]{32}>\.)?([^:.]+):/, "$1$2.");
  return storageMask.toUpperCase().replace(/[\\%_*?]/g, character => {
    if (character === "*")
      return "%";
    if (character === "?")
      return "_";
    return `\\${character}`;
  });
}

function formatRegistryKeyName(name: string): string {
  // Display the stored module separator in the colon form accepted by the CLI.
  return name.replace(/^(<overrideuser>\.|<wrd:[a-f0-9]{32}>\.)?([^:.]+)\./, "$1$2:");
}

runCli({
  description: "Manage registry keys",
  flags: {
    "j,json": { description: "Output in JSON format" }
  },
  subCommands: {
    get: {
      description: "Get a registry key",
      arguments: [{ name: "<keyname>", description: "Registry key to read" }],
      async main({ args, opts }) {
        const value = await readRegistryKey<unknown>(args.keyname, undefined, registryKeyOptions);
        if (opts.json)
          console.log(JSON.stringify(value, null, 2));
        else if (typeof value === "string" || typeof value === "number")
          console.log(value);
        else if (typeof value === "boolean")
          console.log(value ? "true" : "false");
        else
          console.log(encodeHSON(value as IPCMarshallableData));
      }
    },
    list: {
      description: "List registry keys matching a wildcard pattern",
      arguments: [{ name: "<keymask>", description: "Key pattern (module:subkey format; * for any number of characters, ? for one character)" }],
      async main({ args, opts }) {
        const keymask = toRegistryKeyLikeMask(args.keymask);
        const matchkeys = await db<PlatformDB>()
          .selectFrom("system.flatregistry")
          .select(["name", "data", "blobdata"])
          .where(eb => eb(eb.fn("upper", ["name"]), "like", keymask))
          .orderBy(eb => eb.fn("upper", ["name"]))
          .execute();

        if (!matchkeys.length)
          throw new CLIRuntimeError(`No registry keys match the mask '${args.keymask}'`);

        const output = await Promise.all(matchkeys.map(async key => ({
          name: formatRegistryKeyName(key.name),
          value: decodeHSON(key.data || await key.blobdata!.text())
        })));
        if (opts.json)
          console.log(JSON.stringify(output, null, 2));
        else
          console.table(output);
      }
    },
    set: {
      description: "Set a registry key",
      options: {
        type: { description: "Value type (string, boolean, integer, or record)" },
      },
      flags: {
        password: { default: false, description: "Hash a string value as a password" },
      },
      arguments: [
        { name: "<keyname>", description: "Registry key to write" },
        { name: "<value>", description: "Value to write" },
      ],
      async main({ args, opts }) {
        const createIfNeeded = typeof opts.type === "string";
        let valueType = opts.type;
        if (typeof valueType !== "string") {
          const existingValue = await readRegistryKey<unknown>(args.keyname, undefined, registryKeyOptions);
          valueType = getHSTypeName(determineType(existingValue));
        }
        const keytype = valueType.toLowerCase();

        if (opts.password && keytype !== "string")
          throw new CLIRuntimeError("Only keys of type 'string' can be set as a --password");

        let value: unknown;
        switch (keytype) {
          case "string":
            value = opts.password ? await createWebHarePasswordHash(args.value) : args.value;
            break;
          case "boolean":
            value = ["1", "TRUE"].includes(args.value.toUpperCase());
            break;
          case "integer": {
            const parsed = Number.parseInt(args.value, 10);
            value = Number.isNaN(parsed) ? 0 : parsed;
            break;
          }
          case "record": {
            const decoded = decodeHSON(args.value);
            if (decoded !== null && (typeof decoded !== "object" || Array.isArray(decoded)))
              throw new CLIRuntimeError("Value for a record registry key must decode to a record");
            value = decoded;
            break;
          }
          default:
            throw new CLIRuntimeError(`Not sure how to store value of type '${keytype}'`);
        }

        await runInWork(() => writeRegistryKey(args.keyname, value, { ...registryKeyOptions, createIfNeeded }));
        if (opts.json)
          console.log(JSON.stringify({ name: formatRegistryKeyName(args.keyname), updated: true }, null, 2));
      }
    }
  }
});
