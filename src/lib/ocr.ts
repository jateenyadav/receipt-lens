// Backup reader for when the AI can't look at photos (busy / daily limit on the vision model):
// read the text on the phone with tesseract.js, then send only that text to a text AI.
// The library (~3 MB with language data) loads only the first time this runs.

export async function readTextOnDevice(dataUrl: string, onProgress?: (p: number) => void): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress?.(m.progress);
    },
  });
  try {
    const { data } = await worker.recognize(dataUrl);
    return data.text.trim();
  } finally {
    await worker.terminate();
  }
}
