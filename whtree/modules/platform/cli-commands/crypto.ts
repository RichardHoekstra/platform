// @webhare/cli: Manage SSL keys and certificates

import { requestACMECertificate } from "@mod-platform/js/certbot/internal/task";
import { readArgFile } from "@mod-platform/js/cli/cli-tools";
import { listStoredKeyPairsWithCertificates, splitPEMCertificateBundle } from "@mod-platform/js/webserver/keymgmt";
import { CLIRuntimeError, runCli } from "@webhare/cli";
import { loadlib, type HSVMObject } from "@webhare/harescript";
import type { HSVMBlob } from "@webhare/harescript/src/wasm-hsvmvar";
import { decryptForThisServer, type WebHareBlob } from "@webhare/services";
import { beginWork, commitWork } from "@webhare/whdb";
import { openFolder } from "@webhare/whfs";
import { X509Certificate } from "node:crypto";

type KeyPair = HSVMObject & {
  TestCertificate(certdata: WebHareBlob): Promise<{ success: boolean; message?: string; finalkey?: WebHareBlob }>;
  UpdateMetadata(metadata: { certificatechain?: WebHareBlob }): Promise<void>;
  RecycleSelf(): Promise<void>;
};

function getKeystoreLib() {
  return loadlib("mod::system/lib/keystore.whlib");
}

async function openKey(rawkeyname: boolean, hostname: string): Promise<KeyPair> {
  const keystore = getKeystoreLib();
  const keypair = rawkeyname
    ? await keystore.OpenKeyPairByName(hostname) as KeyPair | undefined
    : await keystore.OpenKeyPair(await keystore.GetBestKeyPairForHostName(hostname)) as KeyPair | undefined;

  if (!keypair)
    throw new CLIRuntimeError(`No such key ${rawkeyname ? `'${hostname}'` : `for hostname '${hostname}'`}`);

  return keypair;
}

async function requestCertificate(primaryhostname: string, hostnames: string[], options: { staging: boolean; debug: boolean }): Promise<void> {
  const result = await requestACMECertificate({
    domains: [primaryhostname, ...hostnames],
    //TODO get debug output to go to stdout instead of logDebug
    debug: options.debug,
    staging: options.staging,
    //TODO offer more flags to the CLI ? eg testonly?
  });

  if (!result.success) {
    if (result.error === "hostnotlocal")
      throw new CLIRuntimeError(`The hostname '${result.errorData}' is not hosted on this server`);

    throw new CLIRuntimeError(JSON.stringify(result));
  }

  await commitWork();
  console.log(result.certificateId
    ? `Certificate has been applied and stored as ${(await openFolder(result.certificateId)).whfsPath}`
    : "Staging certificate request succeeded (certificate not stored)");
}

async function getKeyInfo(rawkeyname: boolean, hostname: string, which: "privatekey" | "certificatechain"): Promise<void> {
  const keypair = await openKey(rawkeyname, hostname);
  const blob = await keypair.$get<HSVMBlob>(which);
  process.stdout.write(Buffer.from(await blob.arrayBuffer()));
}

async function setKeyCertificate(rawkeyname: boolean, hostname: string, certdata: WebHareBlob): Promise<void> {
  const keypair = await openKey(rawkeyname, hostname);
  const result = await keypair.TestCertificate(certdata);
  if (!result.success)
    throw new CLIRuntimeError(`Error: ${result.message ?? ""}`);

  await beginWork();
  await keypair.UpdateMetadata({ certificatechain: certdata });
  await commitWork();

  console.log("Certificate has been updated");
}

async function listKeys(_allkeys: boolean): Promise<void> {
  for (const keypair of await listStoredKeyPairsWithCertificates()) {
    const certificate = splitPEMCertificateBundle(keypair.certificatechain)[0];

    console.log(`Key name: ${keypair.name}`);
    if (!certificate) {
      console.log("- No certificate");
    } else {
      const parsed = new X509Certificate(certificate);
      const validUntil = parsed.validToDate;
      const daysRemaining = Math.trunc((validUntil.getTime() - Date.now()) / 86_400_000);

      console.log(`- Common name: ${parsed.subject.split("\n").find(field => field.startsWith("CN="))?.slice(3) ?? ""}`);
      console.log(`- DNS alternative names: ${keypair.dns_altnames.join(" ")}`);
      console.log(`- Issuer: ${parsed.issuer.split("\n").find(field => field.startsWith("CN="))?.slice(3) ?? ""}`);
      console.log(`- Valid until: ${validUntil.toISOString()} (${daysRemaining} days)`);
      console.log();
    }
  }
}

runCli({
  description: "Manage SSL keys and certificates",
  subCommands: {
    "request-certificate": {
      description: "Generate a certificate using ACME",
      flags: {
        staging: "Use the ACME staging environment",
        debug: "Enable debug output",
      },
      arguments: [
        { name: "<primaryhostname>", description: "Primary domain" },
        { name: "[hostnames...]", description: "Additional domains" },
      ],
      async main({ args, opts }) {
        await requestCertificate(args.primaryhostname, args.hostnames, opts);
      }
    },
    "list-keys": {
      description: "List all keys",
      flags: {
        raw: "Keep compatibility with the legacy command syntax",
      },
      async main({ opts }) {
        await listKeys(opts.raw);
      }
    },
    "get-private-key": {
      description: "Output the private key for the requested hostname",
      flags: {
        rawkeyname: "Interpret name as a raw key name",
      },
      arguments: [
        { name: "<hostname>", description: "Hostname or key name" },
      ],
      async main({ args, opts }) {
        await getKeyInfo(opts.rawkeyname, args.hostname, "privatekey");
      }
    },
    "add-private-key": {
      description: "Add a new private key",
      flags: {
        replace: "Replace an existing key",
        rawkeyname: "Interpret name as a raw key name",
      },
      arguments: [
        { name: "<hostname>", description: "Key name" },
        { name: "<filename>", description: "Private key file" },
      ],
      async main({ args, opts }) {
        if (!opts.rawkeyname)
          throw new CLIRuntimeError("Keys can only be added by using a rawkeyname");

        const keystore = getKeystoreLib();
        await beginWork();
        const existingkey = await keystore.OpenKeyPairByName(args.hostname) as KeyPair | undefined;
        if (existingkey) {
          if (!opts.replace)
            throw new CLIRuntimeError(`Key ${args.hostname} already exists`);
          await existingkey.RecycleSelf();
        }

        await keystore.CreateKeyPair(args.hostname, await readArgFile(args.filename));
        await commitWork();
      }
    },
    "get-certificate": {
      description: "Output the certificate for the requested hostname",
      flags: {
        rawkeyname: "Interpret name as a raw key name",
      },
      arguments: [
        { name: "<hostname>", description: "Hostname or key name" },
      ],
      async main({ args, opts }) {
        await getKeyInfo(opts.rawkeyname, args.hostname, "certificatechain");
      }
    },
    "set-certificate": {
      description: "Set the certificate for the requested hostname",
      flags: {
        rawkeyname: "Interpret name as a raw key name",
      },
      arguments: [
        { name: "<hostname>", description: "Hostname or key name" },
        { name: "<filename>", description: "Certificate file, or - to read stdin" },
      ],
      async main({ args, opts }) {
        await setKeyCertificate(opts.rawkeyname, args.hostname, await readArgFile(args.filename));
      }
    },
    "decrypt-server": {
      description: "Decrypt data encrypted by encryptForThisServer",
      arguments: [
        {
          name: "<scope>",
          description: "The scope of the decryption (e.g 'wrd:oidcauth')",
        }, {
          name: "<data>",
          description: "The encrypted data to decrypt",
        }
      ],
      async main({ opts, args }) {
        console.log(JSON.stringify(await decryptForThisServer(args.scope, args.data), null, 2));

      }
    }
  }
});
