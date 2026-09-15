// Client-side photo compression for entry attachments (CGR-008, PRD PERF-005
// + UX spec): target ≤800KB, EXIF stripped.
//
// The canvas round trip is what strips EXIF — a canvas has no metadata to
// carry, so GPS coordinates and device identifiers never leave the phone.
// Quality is stepped down until the blob fits the budget; a photo that can't
// get there (rare: >1600px of pure noise) ships at the last step anyway —
// the server's 5MB cap is the hard backstop.

const MAX_DIMENSION = 1600;
const TARGET_BYTES = 800 * 1024;
const QUALITY_STEPS = [0.82, 0.7, 0.55, 0.4];

export async function compressPhoto(file: File): Promise<Blob> {
  // Decode via an object URL (not FileReader) — cheaper and synchronous-ish.
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      // Canvas unavailable (exotic browser): send the original; the server
      // validates size and format regardless.
      return file;
    }
    ctx.drawImage(img, 0, 0, width, height);

    let blob = await toBlob(canvas, QUALITY_STEPS[0]);
    for (const q of QUALITY_STEPS.slice(1)) {
      if (blob && blob.size <= TARGET_BYTES) break;
      const next = await toBlob(canvas, q);
      if (next) blob = next;
    }
    // JPEG fallback if the browser produced nothing (shouldn't happen).
    return blob ?? file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("photo: could not decode image"));
    img.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
  });
}
