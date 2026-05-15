/**
 * Wangsu / Edge AI Gateway image generation (dvizen-imagen2 chat_image).
 */

export type WangsuImageConfig = {
  baseUrl: string;
  generatePath: string;
  apiKey: string;
  model: string;
};

export function getWangsuImageConfig(): WangsuImageConfig {
  const baseUrl = process.env.WANGSU_BASE_URL?.trim().replace(/\/$/, "") ?? "";
  const generatePath = process.env.WANGSU_GENERATE_PATH?.trim() ?? "";
  const apiKey = process.env.WANGSU_GENERATE_API_KEY?.trim() ?? "";
  const model = process.env.WANGSU_GENERATE_MODEL?.trim() || "gpt-image-2";
  if (!baseUrl || !generatePath || !apiKey) {
    throw new Error(
      "Wangsu image generation requires WANGSU_BASE_URL, WANGSU_GENERATE_PATH, and WANGSU_GENERATE_API_KEY",
    );
  }
  const path = generatePath.startsWith("/") ? generatePath : `/${generatePath}`;
  return { baseUrl, generatePath: path, apiKey, model };
}

function authorizationHeader(apiKey: string): string {
  const scheme = process.env.WANGSU_AUTH_SCHEME?.trim().toLowerCase() ?? "bearer";
  if (scheme === "raw") return apiKey;
  if (scheme === "token") return `Token ${apiKey}`;
  return `Bearer ${apiKey}`;
}

/**
 * POST to the gateway chat_image endpoint.
 * This path expects a top-level `prompt` (not only OpenAI-style `messages`), or the API returns "prompt is required".
 */
export async function wangsuChatImageRequest(prompt: string): Promise<unknown> {
  const { baseUrl, generatePath, apiKey, model } = getWangsuImageConfig();
  const url = `${baseUrl}${generatePath}`;
  const text = prompt.trim();
  const body = {
    model,
    prompt: text,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authorizationHeader(apiKey),
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Wangsu returned non-JSON (HTTP ${res.status}): ${raw.slice(0, 400)}`);
  }

  if (!res.ok) {
    const o = data as { error?: { message?: string }; message?: string };
    const msg = o.error?.message ?? o.message;
    throw new Error(msg || `Wangsu HTTP ${res.status}: ${raw.slice(0, 600)}`);
  }

  return data;
}
