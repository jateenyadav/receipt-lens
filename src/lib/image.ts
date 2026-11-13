// Shrink a receipt photo in the browser before upload (ported from Exam-AI/lib/image.ts).
// Phone photos are 4–12 MB; the server takes JPEG up to ~1.2 MB. iPhone HEIC photos are converted
// first (Safari can read HEIC itself; other browsers need heic2any, loaded only when needed).

export const UPLOAD_TARGET_BYTES = 1_200_000;
const MAX_SIDE = 1800; // receipts are tall and thin: keep enough pixels for small print

export function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export function fitWithin(width: number, height: number, maxSide = MAX_SIDE) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("This photo format can't be read. Please upload a JPG or PNG, or take the photo with the camera button."));
    img.src = src;
  });
}

async function compress(blob: Blob): Promise<string> {
  const src = URL.createObjectURL(blob);
  try {
    const img = await loadImage(src);
    let { width, height } = fitWithin(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Your browser can't process images.");
    for (let attempt = 0; attempt < 6; attempt++) {
      canvas.width = width;
      canvas.height = height;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      for (const quality of [0.85, 0.72, 0.6]) {
        const out = canvas.toDataURL('image/jpeg', quality);
        if (dataUrlBytes(out) <= UPLOAD_TARGET_BYTES) return out;
      }
      width = Math.round(width * 0.8);
      height = Math.round(height * 0.8);
    }
    throw new Error('This photo is too large even after compressing. Please retake it a bit closer.');
  } finally {
    URL.revokeObjectURL(src);
  }
}

const isHeic = (f: File) => /hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name);

export type Photo = { dataUrl: string; base64: string; mimeType: 'image/jpeg' };

export async function preparePhoto(file: File): Promise<Photo> {
  if (!file.type.startsWith('image/') && !isHeic(file)) throw new Error('Please choose a photo (JPG, PNG, WebP or HEIC).');
  let dataUrl: string;
  try {
    dataUrl = await compress(file);
  } catch (err) {
    if (!isHeic(file)) throw err;
    const { default: heic2any } = await import('heic2any');
    const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
    dataUrl = await compress(Array.isArray(out) ? out[0] : out);
  }
  return { dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType: 'image/jpeg' };
}
