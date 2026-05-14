import OpenAI from "openai";

/** Same default origin as `AI generator/server.mjs` (OpenAI-compatible gateway). */
const DEFAULT_OPENAI_BASE_ORIGIN = "https://ai.t8star.cn";

let cached: OpenAI | null = null;

/** OpenAI SDK expects baseURL ending in `/v1`. Accepts origin-only env like the AI generator. */
function normalizeOpenAIAPIBase(input: string): string {
  const trimmed = input.trim();
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    throw new Error(`Invalid OPENAI_BASE_URL: ${input}`);
  }
  let path = u.pathname.replace(/\/+$/, "") || "/";
  if (path === "/") {
    path = "/v1";
  }
  u.pathname = path;
  return `${u.origin}${u.pathname}`;
}

function resolveOpenAIBaseURL(): string {
  const fromEnv = process.env.OPENAI_BASE_URL?.trim();
  const raw = fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_OPENAI_BASE_ORIGIN;
  return normalizeOpenAIAPIBase(raw);
}

export function getOpenAI(): OpenAI {
  if (!cached) {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set");
    }
    cached = new OpenAI({
      apiKey,
      baseURL: resolveOpenAIBaseURL(),
    });
  }
  return cached;
}

export function getOpenAITextModel(): string {
  return process.env.OPENAI_TEXT_MODEL?.trim() || "gpt-4o-mini";
}

export function getOpenAIImageModel(): string {
  return process.env.OPENAI_IMAGE_MODEL?.trim() || "dall-e-3";
}

export type OpenAIImageSize = "1024x1024" | "1792x1024" | "1024x1792";

export function getOpenAIImageSize(): OpenAIImageSize {
  const s = process.env.OPENAI_IMAGE_SIZE?.trim();
  if (s === "1792x1024" || s === "1024x1792" || s === "1024x1024") return s;
  return "1024x1024";
}
