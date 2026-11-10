import { API } from "@/lib/config";

export const MAX_PHOTO_BYTES = 50 * 1024 * 1024;
export const MAX_PHOTOS = 6;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

const isHeic = (f: File) => /^image\/hei[cf]$/.test(f.type) || /\.hei[cf]$/i.test(f.name);

async function toJpeg(src: Blob, max: number): Promise<Blob | null> {
  const bmp = await createImageBitmap(src);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.86));
}

/** Checks the file, converts HEIC (iPhone) to JPEG, and shrinks big photos to 2000 px so listings load fast.
 *  Originals up to 50 MB are accepted. */
export async function preparePhoto(file: File): Promise<Blob> {
  const heic = isHeic(file);
  if (!heic && !TYPES.includes(file.type)) throw new Error("Use a JPEG, PNG, WebP or HEIC photo.");
  if (file.size > MAX_PHOTO_BYTES) throw new Error("That photo is over 50 MB.");

  if (heic) {
    // Safari can decode HEIC itself. Other browsers get a small converter, loaded only when needed.
    try {
      const out = await toJpeg(file, 2000);
      if (out) return out;
    } catch {}
    try {
      const { default: heic2any } = await import("heic2any");
      const conv = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.86 });
      const jpg = Array.isArray(conv) ? conv[0] : conv;
      return (await toJpeg(jpg, 2000)) ?? jpg;
    } catch {
      throw new Error("Couldn’t read that HEIC photo. Try a JPEG instead.");
    }
  }

  try {
    const bmp = await createImageBitmap(file);
    const small = Math.max(bmp.width, bmp.height) <= 2000 && file.size <= 3 * 1024 * 1024;
    bmp.close();
    if (small) return file;
    const out = await toJpeg(file, 2000);
    return out && out.size < file.size ? out : file;
  } catch {
    return file;
  }
}

export async function uploadPhoto(blob: Blob, token: string): Promise<string> {
  const r = await fetch(`${API}/photos`, {
    method: "POST",
    headers: { "Content-Type": blob.type, Authorization: `Bearer ${token}` },
    body: blob,
  });
  if (!r.ok) {
    let m = "Couldn’t upload that photo.";
    try { m = (await r.json()).detail ?? m; } catch {}
    throw new Error(m);
  }
  return (await r.json()).url as string;
}
