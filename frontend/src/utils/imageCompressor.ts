/**
 * Client-Side Offline Image Compressor & Resizer
 * Converts uploaded photos (even high-res 12MP phone camera shots)
 * into lightweight, crisp 250x250 WebP/JPEG data URLs (< 25KB)
 * for lightning-fast offline IndexedDB storage.
 */

export interface CompressOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: 'image/webp' | 'image/jpeg';
}

/**
 * Compresses an image File or Blob using HTML5 Canvas
 */
export async function compressImageFile(
  file: File | Blob,
  options: CompressOptions = {}
): Promise<string> {
  const {
    maxWidth = 260,
    maxHeight = 260,
    quality = 0.82,
    format = 'image/webp',
  } = options;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to decode image'));
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        // Calculate aspect-ratio preserving dimensions
        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(e.target?.result as string);
          return;
        }

        // Draw with high quality smoothing
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        // Try WebP first, fall back to JPEG if unsupported
        let dataUrl = canvas.toDataURL(format, quality);
        if (format === 'image/webp' && dataUrl.startsWith('data:image/png')) {
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }

        resolve(dataUrl);
      };

      img.src = e.target?.result as string;
    };

    reader.readAsDataURL(file);
  });
}

/**
 * Loads an image from a URL or Data URL, resizes and compresses it to clean base64 WebP/JPEG
 */
export async function compressImageUrl(
  url: string,
  options: CompressOptions = {}
): Promise<string> {
  const {
    maxWidth = 260,
    maxHeight = 260,
    quality = 0.82,
    format = 'image/webp',
  } = options;

  let sourceUrl = url;

  // If remote HTTP/HTTPS URL, proxy through local PHP API to bypass CORS & hotlink blocking
  if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      const res = await fetch('/api/products/proxy-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data?.dataUrl) {
          sourceUrl = json.data.dataUrl;
        }
      }
    } catch {
      // Offline or network error - proceed with direct load
    }
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    // Only use anonymous crossOrigin if not a data URL
    if (!sourceUrl.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }
    img.referrerPolicy = 'no-referrer';

    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(sourceUrl);
        return;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);

      try {
        let dataUrl = canvas.toDataURL(format, quality);
        if (format === 'image/webp' && dataUrl.startsWith('data:image/png')) {
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(dataUrl);
      } catch {
        // Tainted canvas due to CORS - return sourceUrl
        resolve(sourceUrl);
      }
    };
    img.onerror = () => {
      // Fallback: If anonymous failed, try without crossOrigin to allow displaying
      if (img.crossOrigin) {
        const fallbackImg = new Image();
        fallbackImg.referrerPolicy = 'no-referrer';
        fallbackImg.onload = () => resolve(sourceUrl);
        fallbackImg.onerror = () => reject(new Error('Failed to load image from URL'));
        fallbackImg.src = sourceUrl;
      } else {
        reject(new Error('Failed to load image from URL'));
      }
    };
    img.src = sourceUrl;
  });
}

/**
 * Validates whether a string is a valid Data URL or remote image URL
 */
export function isValidImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (trimmed.startsWith('data:image/')) {
    // Truncated data URLs are shorter than ~500 chars and cannot render
    return trimmed.length > 500;
  }
  return (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/uploads/') ||
    trimmed.startsWith('/assets/')
  );
}

