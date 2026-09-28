import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { backendConfig, ResourceDescriptor } from "@webhare/services";
import { createSharpImage, type Sharp } from "@webhare/deps/src/deps";

async function attemptFetch(finalurl: string, expectType: string) {
  const fetchResult = await fetch(finalurl);
  test.eq(200, fetchResult.status, `Failed to fetch ${finalurl}`);

  const contentType = fetchResult.headers.get("content-type") || '';
  const cacheControl = fetchResult.headers.get("cache-control") || '';
  const fetchBuffer = await fetchResult.arrayBuffer();
  const isFastResult = ["image/jpeg", "image/png"].includes(contentType) && !cacheControl.includes("immutable");

  if (isFastResult && contentType !== expectType)
    return null; //this was a fast result, wait for the final

  const actualImage = await ResourceDescriptor.from(Buffer.from(fetchBuffer), { getImageMetadata: true });
  test.eq(contentType, actualImage.mediaType);

  return { contentType, cacheControl, fetchBuffer, fetchResult, isFastResult };
}

export async function fetchUCLink(url: string, expectType: string) {
  const finalurl = new URL(url, backendConfig.backendURL).href;

  const { contentType, cacheControl, fetchBuffer, fetchResult, isFastResult } = await test.wait(() => attemptFetch(finalurl, expectType), { annotation: `Waiting for ${finalurl} to be available with content-type ${expectType}` });

  test.eq(expectType, contentType);
  const fetchData = await ResourceDescriptor.from(Buffer.from(fetchBuffer), { getImageMetadata: true, getHash: true });
  return { resource: fetchData, finalurl, fetchBuffer, cacheControl, contentType, lastModified: fetchResult.headers.get("Last-Modified"), isFastResult };
}

export async function compareSharpImages(expect: Sharp | string, actual: Sharp, { minMSE = 0, maxMSE = 0 } = {}) {
  if (typeof expect === "string")
    expect = await createSharpImage(expect);

  const rawExpect = await expect.raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
  const rawActual = await actual.raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
  test.eq(rawExpect.info, rawActual.info);

  let totalDiff = 0; //squared absolute difference
  for (let row = 0; row < rawActual.info.height; ++row)
    for (let col = 0; col < rawActual.info.width; ++col)
      for (let channel = 0; channel < rawActual.info.channels; ++channel) {
        const idx = (row * rawActual.info.width + col) * rawActual.info.channels + channel;
        totalDiff += Math.pow(Math.abs(rawExpect.data[idx] - rawActual.data[idx]), 2);
      }

  const mse = totalDiff / (rawActual.info.width * rawActual.info.height * rawActual.info.channels);
  if (mse > maxMSE)
    throw new Error(`MSE too high: ${mse} > ${maxMSE}`);
  if (mse < minMSE)
    throw new Error(`MSE too low: ${mse} < ${minMSE}`);
}
