/* This files lives in whtree/nginx-router as it requires libraries incompatible with node
   (eg. readFileSync in nodejs doesn't accept 'utf-8' as the encoding parameter, only 'utf8')

   TODO: still need to tsc-validate this during WebHare builds
*/

// Set up TS validation using njs-types npm module:
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../node_modules/njs-types/ngx_http_js_module.d.ts" />

import fs from "fs";

// Helper to sanitize hostnames and prevent path traversal (e.g., ../)
function sanitizeHost(host: string | undefined) {
  if (!host)
    return null;

  const clean = host.split(':')[0].toLowerCase();
  // Allow only alphanumeric characters, hyphens, and dots
  if (!/^[a-z0-9.-]+$/.test(clean) || clean.includes('..')) {
    return null;
  }
  return clean;
}

// Unified resolver: checks shared cache first, falls back to config.json
function resolveDomain(r: NginxHTTPRequest) {
  const host = sanitizeHost(r.variables.ssl_server_name || r.variables.host) || 'default';

  // 1. Check Shared Cache First
  let cert = ngx.shared.cert_store.get(host + ':cert');
  let key = ngx.shared.cert_store.get(host + ':key');
  let dataroot = ngx.shared.cert_store.get(host + ':dataroot');

  if (cert && key && dataroot) {
    return { cert, key, dataroot };
  }

  // 2. Cache Miss: Resolve $WEBHARE_DATAROOT environment variable path
  const configRoot = `${process.env.WEBHARE_DATAROOT}config/nginx/`;
  const configPath = `${configRoot}server-config.json`;

  let matchedConfig = null;

  try {
    const rawData = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(rawData);
    const domains = config.domains || {};

    // Look for exact match
    if (domains[host]) {
      matchedConfig = domains[host];
    } else {
      // Check wildcard matches (e.g. *.example.dev)
      for (const pattern in domains) {
        if (pattern.startsWith('*.')) {
          const suffix = pattern.slice(1);
          if (host.endsWith(suffix)) {
            matchedConfig = domains[pattern];
            break;
          }
        }
      }
    }

    // Fall back to default block
    if (!matchedConfig && domains['default']) {
      matchedConfig = domains['default'];
    }
  } catch (e) {
    ngx.log(ngx.ERR, `[NJS] Failed to read ${configPath}: ${(e as Error).message}`);
  }

  cert = matchedConfig ? matchedConfig.cert : '';
  key = matchedConfig ? matchedConfig.key : '';
  dataroot = matchedConfig ? matchedConfig.dataRoot : null; //FIXME what will happen with requests ?

  // 3. Store matched PEM strings and path in Shared Cache for future handshakes
  if (cert) ngx.shared.cert_store.set(host + ':cert', cert);
  if (key) ngx.shared.cert_store.set(host + ':key', key);
  if (dataroot) ngx.shared.cert_store.set(host + ':dataroot', dataroot);

  return { cert, key, dataroot };
}

function getCertPem(r: NginxHTTPRequest) {
  return resolveDomain(r).cert;
}

function getKeyPem(r: NginxHTTPRequest) {
  return resolveDomain(r).key;
}

function getDataRootPath(r: NginxHTTPRequest) {
  return resolveDomain(r).dataroot;
}

function getFileRoute(r: NginxHTTPRequest) {
  if (!r.uri.endsWith('.shtml') && !r.uri.endsWith('/index.html'))
    return '000';

  const filename = r.variables.request_filename;
  if (!filename)
    return '000';

  let contents: string;
  try {
    contents = fs.readFileSync(filename, 'utf8');
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR')
      return '000';
    ngx.log(ngx.ERR, `[NJS] Failed to read ${filename}: ${(error as Error).message}`);
    return '403';
  }

  const marker = 'WBHRWS::v0dmzc5chW4AxhbiSdDpJQ\r\n';
  if (!contents.startsWith(marker))
    return '000';

  try {
    const metadata: unknown = JSON.parse(contents.slice(marker.length));
    if (metadata && typeof metadata === 'object') {
      if ('redirect' in metadata && typeof metadata.redirect === 'string') {
        r.variables.file_redirect = metadata.redirect;
        return '303';
      }
      if ('abtest' in metadata) {
        // FIXME: Implement A/B test routing.
        return '500';
      }
      if ('js' in metadata) {
        if (metadata.js === false)
          return '418';
        if (metadata.js === true)
          return '403';
      }
    }
  } catch (error) {
    ngx.log(ngx.ERR, `[NJS] Invalid execution metadata in ${filename}: ${(error as Error).message}`);
  }
  return '403';
}

function getLogTimestamp(r: NginxHTTPRequest) {
  return new Date(Math.round(Number(r.variables.msec) * 1000)).toISOString();
}

if (!process.env.WEBHARE_DATAROOT)
  throw new Error('WEBHARE_DATAROOT environment variable is not set');

export default { getCertPem, getKeyPem, getDataRootPath, getFileRoute, getLogTimestamp };
