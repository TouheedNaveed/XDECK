/**
 * Icons and backgrounds are stored inline in the deck config as data URLs.
 *
 * The alternative — uploading to the desktop and referencing
 * `http://<lan-ip>:8787/uploads/...` — only renders while the phone is on the same
 * network as the desktop and its IP hasn't changed. Over the relay, from a hosted
 * https origin, or offline, those URLs are unreachable and every icon silently
 * breaks. Inlining costs some config size but works everywhere, so images are
 * downscaled and re-encoded aggressively before they go in.
 */

/** Icons render at ~90px on screen; 192px covers 2x displays. */
export const ICON_MAX_PX = 192;
export const ICON_QUALITY = 0.85;

/** Backgrounds are stretched over the viewport but re-sent on every config sync. */
export const BACKGROUND_MAX_PX = 1280;
export const BACKGROUND_QUALITY = 0.72;

/** Refuse anything that would bloat every subsequent config_sync. */
const MAX_RESULT_BYTES = 900 * 1024;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image'));
    img.src = src;
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function canvasToDataUrl(canvas: HTMLCanvasElement, quality: number): string {
  // WebP is far smaller than JPEG at equal quality and is supported by every
  // browser that can run this PWA; JPEG is the fallback for old WebViews.
  const webp = canvas.toDataURL('image/webp', quality);
  if (webp.startsWith('data:image/webp')) return webp;
  return canvas.toDataURL('image/jpeg', quality);
}

export interface CompressResult {
  dataUrl?: string;
  error?: string;
}

/**
 * Downscales `file` to fit `maxPx` on its longest edge and returns a data URL.
 * Transparency is preserved (WebP), so icons keep their cut-outs.
 */
export async function compressImageToDataUrl(
  file: File,
  maxPx: number,
  quality: number,
): Promise<CompressResult> {
  if (!file.type.startsWith('image/')) {
    return { error: 'That file is not an image' };
  }

  // Vectors already scale perfectly and are tiny — keep them byte-for-byte.
  if (file.type === 'image/svg+xml') {
    if (file.size > MAX_RESULT_BYTES) return { error: 'That SVG is too large (max 900 KB)' };
    try {
      return { dataUrl: await readAsDataUrl(file) };
    } catch (e: any) {
      return { error: e.message };
    }
  }

  let objectUrl: string | null = null;
  try {
    objectUrl = URL.createObjectURL(file);
    const img = await loadImage(objectUrl);

    const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { error: 'Image processing is unavailable on this device' };
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);

    let dataUrl = canvasToDataUrl(canvas, quality);
    // Photographs with lots of detail can still overshoot; step the quality down
    // rather than rejecting a picture the user just took.
    for (let q = quality - 0.2; dataUrl.length > MAX_RESULT_BYTES && q >= 0.4; q -= 0.2) {
      dataUrl = canvasToDataUrl(canvas, q);
    }
    if (dataUrl.length > MAX_RESULT_BYTES) {
      return { error: 'That image is too detailed to store — try a smaller one' };
    }
    return { dataUrl };
  } catch (e: any) {
    return { error: e?.message || 'Could not process that image' };
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/** True for values a browser can render without reaching the desktop. */
export function isPortableImage(value: string): boolean {
  return !!value && (value.startsWith('data:') || value.startsWith('blob:'));
}
