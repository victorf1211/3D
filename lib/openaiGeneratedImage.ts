/**
 * Normalize OpenAI / OpenAI-compatible image generation responses (gateways vary).
 */

function stripWhitespaceBase64(s: string): string {
  return s.replace(/\s+/g, "");
}

/** If the API put a full data URL inside b64_json, return raw base64 payload. */
function peelDataUrlBase64(s: string): { mime?: string; b64: string } {
  const t = s.trim();
  const m = /^data:([^;]+);base64,(.+)$/is.exec(t);
  if (m) {
    return { mime: m[1].trim(), b64: stripWhitespaceBase64(m[2]) };
  }
  return { b64: stripWhitespaceBase64(t) };
}

function mimeFromMagic(buf: Buffer): string {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }
  return "image/png";
}

function firstImageObject(img: unknown): Record<string, unknown> | null {
  if (!img || typeof img !== "object") return null;
  const o = img as Record<string, unknown>;

  const fromArr = (arr: unknown): Record<string, unknown> | null => {
    if (!Array.isArray(arr) || !arr[0] || typeof arr[0] !== "object") return null;
    return arr[0] as Record<string, unknown>;
  };

  return (
    fromArr(o.data) ||
    fromArr((o.result as Record<string, unknown> | undefined)?.images) ||
    null
  );
}

function pickUrl(row: Record<string, unknown>): string | null {
  const u = row.url;
  if (typeof u === "string" && u.trim()) return u.trim();
  const iu = row.image_url;
  if (typeof iu === "string" && iu.trim()) return iu.trim();
  if (iu && typeof iu === "object" && "url" in iu && typeof (iu as { url: unknown }).url === "string") {
    return String((iu as { url: string }).url).trim();
  }
  return null;
}

function pickBase64String(row: Record<string, unknown>): string | null {
  const candidates = [
    row.b64_json,
    row.image_base64,
    row.base64,
    row.image_b64,
    row.b64,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c;
  }
  return null;
}

export type ResolvedGeneratedImage = {
  imageBase64: string;
  mimeType: string;
  dataUrl: string;
};

export async function resolveGeneratedImageBytes(img: unknown): Promise<ResolvedGeneratedImage | null> {
  const row = firstImageObject(img);
  if (!row) return null;

  const url = pickUrl(row);
  const b64Raw = pickBase64String(row);

  if (b64Raw) {
    const peeled = peelDataUrlBase64(b64Raw);
    let buf: Buffer;
    try {
      buf = Buffer.from(peeled.b64, "base64");
    } catch {
      return null;
    }
    if (!buf.length) return null;
    const sniffed = mimeFromMagic(buf);
    const mimeType = peeled.mime?.startsWith("image/") ? peeled.mime : sniffed;
    const imageBase64 = buf.toString("base64");
    return {
      imageBase64,
      mimeType,
      dataUrl: `data:${mimeType};base64,${imageBase64}`,
    };
  }

  if (url) {
    const res = await fetch(url);
    if (!res.ok) return null;
    const headerMime = res.headers.get("content-type")?.split(";")[0]?.trim();
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return null;
    const sniffed = mimeFromMagic(buf);
    const mimeType =
      headerMime && headerMime.startsWith("image/") ? headerMime : sniffed;
    const imageBase64 = buf.toString("base64");
    return {
      imageBase64,
      mimeType,
      dataUrl: `data:${mimeType};base64,${imageBase64}`,
    };
  }

  return null;
}
