import { getAssetPackBase } from "@mod-platform/js/concepts/frontend"; //TODO should probably move here in WH5.7 but too much for a backport
import { encodeString } from "@webhare/std";

export function encodeAttr(s: string): string {
  return encodeString(s, "attribute");
}

/** Get the link and script tags needed to add a specific assetpack
 * @param assetpack The name of the asset pack to integrate.
 * @param options.designRoot The design root URL to resolve relative asset paths.
 * @param options.cacheBuster A string to append as a cache buster to the asset URLs.
 * @returns The HTML string to include the asset pack's CSS and JavaScript.
 */
export function getAssetPackIntegrationCode(assetpack: string, options?: { designRoot?: string | null; cacheBuster?: string }) {
  let bundleBaseUrl = getAssetPackBase(assetpack);
  let scriptsettings = '';
  if (options?.designRoot) {
    scriptsettings += ' crossorigin="anonymous"';
    bundleBaseUrl = new URL(bundleBaseUrl, options.designRoot).toString();
  }

  scriptsettings += ' async type="module"';

  if (options?.cacheBuster)
    bundleBaseUrl = "/!" + encodeURIComponent(options.cacheBuster) + bundleBaseUrl;

  return `<link rel="stylesheet" href="${encodeAttr(bundleBaseUrl)}ap.css">`
    + `<script src="${encodeAttr(bundleBaseUrl)}ap.mjs"${scriptsettings}></script>`;
}
