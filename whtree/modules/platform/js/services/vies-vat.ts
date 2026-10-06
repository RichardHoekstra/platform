// https://ec.europa.eu/assets/taxud/vow-information/swagger_publicVAT.yaml

import { dtapStage } from "@webhare/env";
import { LocalCache } from "@webhare/services";
import { logRPCTraffic } from "@webhare/services/src/logging";
import { convertWaitPeriodToDate, type WaitPeriod } from "@webhare/std";

const viesCheckVatUrl = "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";
const successTTL = 15 * 60 * 1000;
const failureTTL = 1000;

export type ViesVatLookupResult = {
  /** Country code as used by VIES (eg 'NL', 'EL' for Greece) */
  countryCode: string;
  /** VAT number without country code */
  vatNumber: string;
  valid: boolean;
  requestDate: Temporal.Instant;
  /** Registered name, if disclosed by the member state */
  name: string;
  /** Registered address, if disclosed by the member state */
  address: string;
};

type CheckVatResponse = {
  countryCode: string;
  vatNumber: string;
  requestDate: string;
  valid: boolean;
  name?: string;
  address?: string;
  userError?: string;
  actionSucceed?: boolean;
  errorWrappers?: Array<{ error?: string; message?: string }>;
};

type CachedLookup = { result: ViesVatLookupResult; error?: never } | { result?: never; error: string };

const lookupCache = new LocalCache<CachedLookup>({ maxSize: 1000 });

function cleanTraderField(value: string | undefined): string {
  return !value || value === "---" ? "" : value.trim();
}

/* Hardcoded test values (not on production):
   NL999996514B01, BE9999999901 - always throw 'Temporary unavailable'
   NL999996514B02, BE9999999902 - always valid
   NL999996514B03, BE9999999903 - always invalid */
function getTestResult(countryCode: string, vatNumber: string): ViesVatLookupResult | null {
  if (dtapStage === "production" || !/^(NL999996514B0|BE999999990)[123]$/.test(countryCode + vatNumber))
    return null;
  if (vatNumber.endsWith("1"))
    throw new Error("Temporary unavailable");

  const valid = vatNumber.endsWith("2");
  const isNL = countryCode === "NL";
  return {
    countryCode,
    vatNumber,
    valid,
    requestDate: Temporal.Now.instant(),
    name: valid ? isNL ? "TEST COMPANY BV" : "Happy VZW" : "",
    address: valid ? isNL ? "HENGELOSESTRAAT 00296\n7521AM ENSCHEDE" : "Brusselstraat 12345\n12345 Brussel" : "",
  };
}

async function executeLookup(countryCode: string, vatNumber: string, deadline: Date): Promise<ViesVatLookupResult> {
  const testResult = getTestResult(countryCode, vatNumber);
  if (testResult)
    return testResult;

  const requestBody = JSON.stringify({ countryCode, vatNumber });
  await logRPCTraffic("system:taxservices.vies", viesCheckVatUrl, "outgoing", requestBody);
  const response = await fetch(viesCheckVatUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: requestBody,
    signal: AbortSignal.timeout(Math.max(0, deadline.getTime() - Date.now()))
  });

  const body = await response.json().catch(() => null) as CheckVatResponse | null;
  await logRPCTraffic("system:taxservices.vies", viesCheckVatUrl, "incoming", body ?? { status: response.status });
  if (!response.ok || !body || body.actionSucceed === false || body.errorWrappers?.length) {
    const reason = body?.errorWrappers?.map(e => e.error || e.message).filter(Boolean).join(", ");
    throw new Error(`VIES lookup failed: ${reason || `HTTP ${response.status}`}`);
  }
  if (body.userError && !["VALID", "INVALID"].includes(body.userError))
    throw new Error(`VIES lookup failed: ${body.userError}`);

  return {
    countryCode: body.countryCode,
    vatNumber: body.vatNumber,
    valid: Boolean(body.valid),
    requestDate: body.requestDate ? Temporal.Instant.from(body.requestDate) : Temporal.Now.instant(),
    name: cleanTraderField(body.name),
    address: cleanTraderField(body.address),
  };
}

/** Get the country prefixes accepted by VIES: the EU VAT countries plus "XI" for Northern Ireland */
export function getValidViesPrefixes(): string[] {
  return ["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK", "XI"];
}

/** Lookup a VAT number using the EU VIES service
 * @param vatCode - VAT number including country prefix (eg 'NL123456789B01'). Spaces, dots and dashes are ignored
 * @param options.timeout - Maximum time to wait for VIES. Defaults to 5000 msec
 * @returns The lookup result. Note that `valid: false` indicates the number is unknown, failures to reach VIES throw
 */
export async function lookupViesVatCode(vatCode: string, options?: { timeout?: WaitPeriod }): Promise<ViesVatLookupResult> {
  const deadline = convertWaitPeriodToDate(options?.timeout ?? 5000);
  const normalized = vatCode.replace(/[\s.-]/g, "").toUpperCase();
  const match = normalized.match(/^([A-Z]{2})([0-9A-Z+*]{2,12})$/);
  if (!match)
    throw new Error(`Invalid VAT number '${vatCode}'`);
  if (!getValidViesPrefixes().includes(match[1]))
    throw new Error(`Invalid VAT number prefix '${match[1]}'`);

  const [, countryCode, vatNumber] = match;
  const lookup = await lookupCache.get(normalized, async () => {
    try {
      return { value: { result: await executeLookup(countryCode, vatNumber, deadline) }, masks: [], ttl: successTTL };
    } catch (e) {
      return { value: { error: (e as Error).message || String(e) }, masks: [], ttl: failureTTL };
    }
  });

  if (lookup.error !== undefined)
    throw new Error(lookup.error);
  return lookup.result;
}
