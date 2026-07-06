/**
 * Resizes an image file down to a max dimension before it's uploaded.
 * A full-resolution phone photo (often 3000px+ wide) is far bigger than a
 * vision model needs to read a business card. Shrinking it client-side
 * means less data over the wire and a faster round trip — since the API
 * call already uses "detail: low" (which downsamples internally), sending
 * something reasonably sized keeps things fast without losing readability.
 */
export async function resizeImageFile(
  file: File,
  maxDimension = 1200,
  quality = 0.85
): Promise<File> {
  // Skip resizing for already-small files or non-image types.
  if (!file.type.startsWith("image/") || file.size < 400 * 1024) {
    return file;
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));

  if (scale === 1) return file;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const ctx = canvas.getContext("2d");
  if (!ctx) return file;

  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality)
  );

  if (!blob) return file;

  return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
    type: "image/jpeg",
  });
}
