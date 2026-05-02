/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Rasterizes a source (SVG or Image) to a JPG Blob, optionally hitting a target file size.
 * @param source The source image element (already loaded).
 * @param width Target width in pixels.
 * @param height Target height in pixels.
 * @param targetSizeMb Optional target file size in Megabytes.
 * @returns A Promise that resolves to a Blob (JPG).
 */
async function rasterizeToJpg(
  source: HTMLImageElement,
  width: number,
  height: number,
  targetSizeMb?: number
): Promise<Blob> {
  if (width <= 0 || height <= 0) {
    throw new Error('Invalid dimensions requested for rasterization.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });

  if (!ctx) {
    throw new Error('Could not get canvas context');
  }

  // High quality rendering
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Set background to white for JPG
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  ctx.drawImage(source, 0, 0, width, height);

  if (!targetSizeMb) {
    // Standard high quality output
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Rasterization failed'));
      }, 'image/jpeg', 0.95);
    });
  }

  // Fast Target Size Logic: Adaptive single-pass estimate
  const targetBytes = targetSizeMb * 1024 * 1024;
  let quality = 0.92;
  let blob: Blob | null = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
  
  if (blob && blob.size > targetBytes) {
    const ratio = targetBytes / blob.size;
    quality = Math.max(0.1, quality * ratio * 0.9);
    blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
  }

  if (blob) {
    if (blob.size < targetBytes) {
      const padding = new Uint8Array(targetBytes - blob.size);
      return new Blob([blob, padding], { type: 'image/jpeg' });
    }
    return blob;
  }
  
  throw new Error('Synthesis Fault');
}

/**
 * Converts an SVG string to a JPG Blob.
 */
export async function svgToJpg(
  svgCode: string,
  width: number,
  height: number,
  targetSizeMb?: number
): Promise<Blob> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgCode.trim(), 'image/svg+xml');
  const svgTag = doc.querySelector('svg');

  if (!svgTag) {
    throw new Error('Invalid SVG code: No <svg> tag detected.');
  }

  // Mandatory namespaces for standalone rendering and xlink support
  if (!svgTag.getAttribute('xmlns')) {
    svgTag.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  if (!svgTag.getAttribute('xmlns:xlink')) {
    svgTag.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  }
  if (!svgTag.getAttribute('version')) {
    svgTag.setAttribute('version', '1.1');
  }

  // Extract existing dimensions or viewBox for better scaling
  const originalWidth = parseFloat(svgTag.getAttribute('width') || '0');
  const originalHeight = parseFloat(svgTag.getAttribute('height') || '0');
  const hasViewBox = svgTag.getAttribute('viewBox');

  if (!hasViewBox && originalWidth > 0 && originalHeight > 0) {
    svgTag.setAttribute('viewBox', `0 0 ${originalWidth} ${originalHeight}`);
  }

  // Apply target dimensions for rasterization
  svgTag.setAttribute('width', width.toString());
  svgTag.setAttribute('height', height.toString());
  svgTag.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const serializer = new XMLSerializer();
  const finalSvg = serializer.serializeToString(doc);

  const img = new Image();
  // Use Base64 encoding to avoid some blob-related security decoding issues in certain headless/older environments
  const base64Svg = btoa(unescape(encodeURIComponent(finalSvg)));
  const url = `data:image/svg+xml;base64,${base64Svg}`;

  try {
    await new Promise((resolve, reject) => {
      img.onload = async () => {
        // Once onload fires, the image is conceptually "ready". 
        // We try decode() as an extra step but don't fail if it doesn't work.
        if ('decode' in img) {
          try {
            await img.decode();
          } catch (e) {
            console.warn('Image decode failed but proceeding with onload', e);
          }
        }
        resolve(true);
      };
      img.onerror = (e) => {
        console.error('SVG Image Load Error', e);
        reject(new Error('The source image cannot be decoded. This usually happens with malformed SVGs or unresolvable internal links.'));
      };
      img.src = url;
      // Timeout fallback
      setTimeout(() => reject(new Error('Synthesis Timeout: Image took too long to load')), 20000);
    });

    const result = await rasterizeToJpg(img, width, height, targetSizeMb);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown Fault';
    throw new Error(`Rasterization Failure: ${msg}`);
  }
}

/**
 * Converts an Image File to a JPG Blob with custom resolution and target size.
 */
export async function imageToJpg(
  file: File,
  width: number,
  height: number,
  targetSizeMb?: number
): Promise<Blob> {
  const img = new Image();
  const url = URL.createObjectURL(file);
  
  try {
    await new Promise((resolve, reject) => {
      img.onload = async () => {
        if ('decode' in img) {
          try {
            await img.decode();
          } catch (e) {
            console.warn('Decode failed but proceeding', e);
          }
        }
        resolve(true);
      };
      img.onerror = () => reject(new Error('The source image cannot be decoded. File might be corrupted or unsupported.'));
      img.src = url;
      setTimeout(() => reject(new Error('Asset Load Timeout')), 20000);
    });

    const result = await rasterizeToJpg(img, width, height, targetSizeMb);
    URL.revokeObjectURL(url);
    return result;
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}
