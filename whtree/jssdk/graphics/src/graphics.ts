// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/graphics" {
}

import { resizeImageData } from "@mod-platform/js/cache/imgcache";
import type { Sharp } from "@webhare/deps";
import type { ResourceDescriptor, ResizeMethod } from "@webhare/services";
import { createSharpImageFromBlob, mimeToExt, suggestImageFormat } from "@webhare/services/src/descriptor";
import { extname } from "node:path";

export { createQRCode } from "./qrcode";

/** Prepare a resized image for further processing with Sharp. Defaults to keeping the source format. */
export async function createdResizedSharpImage(resource: ResourceDescriptor, method: ResizeMethod): Promise<Sharp> {
  return await resizeImageData(resource, resource.file, { ...method, format: method.format ?? "keep" })
    ?? await createSharpImageFromBlob(resource.file, { mediaType: resource.mediaType });
}

/** Resize an image and return a File with the output MIME type and matching filename extension. */
export async function resizeImage(resource: ResourceDescriptor, method: ResizeMethod): Promise<File> {
  const image = await createdResizedSharpImage(resource, method);
  const mediaType = !method.format || method.format === "keep" ? suggestImageFormat(resource.mediaType) : method.format;
  const fileName = resource.fileName || "image";
  const extension = extname(fileName);
  const outputName = fileName.slice(0, fileName.length - extension.length) + mimeToExt[mediaType];
  return new File([await image.toBuffer()], outputName, { type: mediaType });
}
