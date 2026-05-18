/**
 * Normalize OpenAI / OpenAI-compatible image generation responses (gateways vary).
 */

function stripWhitespaceBase64(s: string): string {
  return s.replace(/\s+/g, "");
}

/** If the API put a full data URL inside b64_json, return raw base64 payload. */
function peelDataUrlBase64(s: string): { mime?: string; b64: string } {
  const t = s.trim();
  const m = /^data:([^;]+);base64,([\s\S]+)$/i.exec(t);
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

async function resolveImageRow(row: Record<string, unknown>): Promise<ResolvedGeneratedImage | null> {
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

function firstChoiceMessage(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const choices = o.choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return null;
  const ch = choices[0] as Record<string, unknown>;
  const msg = ch.message;
  if (!msg || typeof msg !== "object") return null;
  return msg as Record<string, unknown>;
}

async function resolveFromMessageContent(content: unknown): Promise<ResolvedGeneratedImage | null> {
  if (typeof content === "string") {
    const t = content.trim();
    if (t.startsWith("data:image")) {
      return resolveImageRow({ image_url: t });
    }
    return null;
  }

  if (!Array.isArray(content)) return null;

  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    const t = p.type;
    if (t === "image_url" && p.image_url) {
      const resolved = await resolveImageRow({ image_url: p.image_url });
      if (resolved) return resolved;
    }
    if ((t === "image" || t === "output_image") && typeof p.image === "string") {
      const r = await resolveImageRow({ b64_json: p.image });
      if (r) return r;
    }
    if (t === "text" && typeof p.text === "string" && p.text.trim().startsWith("data:image")) {
      const r = await resolveImageRow({ image_url: p.text });
      if (r) return r;
    }
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
  return resolveImageRow(row);
}

/**
 * OpenAI images API, plus chat-style responses and a few gateway-specific shapes.
 */
export async function resolveFlexibleGeneratedImage(data: unknown): Promise<ResolvedGeneratedImage | null> {
  const fromImages = await resolveGeneratedImageBytes(data);
  if (fromImages) return fromImages;

  if (data && typeof data === "object") {
    const root = data as Record<string, unknown>;
    const direct = await resolveImageRow(root);
    if (direct) return direct;

    const img = root.image;
    if (img && typeof img === "object") {
      const r = await resolveImageRow(img as Record<string, unknown>);
      if (r) return r;
    }

    const images = root.images;
    if (Array.isArray(images) && images[0] && typeof images[0] === "object") {
      const r = await resolveImageRow(images[0] as Record<string, unknown>);
      if (r) return r;
    }

    const result = root.result;
    if (result && typeof result === "object") {
      const r = await resolveImageRow(result as Record<string, unknown>);
      if (r) return r;
    }
  }

  const msg = firstChoiceMessage(data);
  if (msg) {
    const fromMsg = await resolveImageRow(msg);
    if (fromMsg) return fromMsg;
    const fromContent = await resolveFromMessageContent(msg.content);
    if (fromContent) return fromContent;
  }

  return null;
}
