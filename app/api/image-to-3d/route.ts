import { NextResponse } from "next/server";
import { stripDataUrlBase64 } from "@/lib/image";

export const maxDuration = 300;

type Body = {
  imageBase64?: string;
  texture?: boolean;
  removeBackground?: boolean;
  seed?: number;
  asyncMode?: boolean;
  fallbackToUntextured?: boolean;
};

type HunyuanPayload = {
  image: string;
  texture: boolean;
  remove_background: boolean;
  seed: number;
};

async function generateModel(baseUrl: string, payload: HunyuanPayload) {
  const res = await fetch(`${baseUrl}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const contentType = res.headers.get("content-type") ?? "";

  if (!res.ok) {
    return {
      ok: false as const,
      status: res.status,
      detail: (await res.text()).slice(0, 2000),
    };
  }

  if (contentType.includes("application/json")) {
    return {
      ok: false as const,
      status: 502,
      detail: JSON.stringify(await res.json()).slice(0, 2000),
    };
  }

  return {
    ok: true as const,
    buffer: await res.arrayBuffer(),
  };
}

function textureFailureHint(detail: string) {
  const genericHunyuanError = /NETWORK ERROR DUE TO HIGH TRAFFIC|error_code/i.test(detail);
  if (genericHunyuanError) {
    return " Hunyuan3D returned its generic server-error response. Check the Hunyuan terminal logs; if it mentions texture, start api_server.py with --enable_tex or use the untextured fallback.";
  }
  return " Texture generation needs the Hunyuan texture pipeline. Start api_server.py with --enable_tex, or use the untextured fallback with the detected color tint.";
}

export async function POST(req: Request) {
  try {
    const baseUrl = process.env.HUNYUAN3D_BASE_URL?.replace(/\/$/, "");
    if (!baseUrl) {
      return NextResponse.json(
        { error: "Set HUNYUAN3D_BASE_URL to your Hunyuan3D API server (e.g. http://127.0.0.1:8081)" },
        { status: 500 },
      );
    }

    const body = (await req.json()) as Body;
    if (!body.imageBase64?.trim()) {
      return NextResponse.json({ error: "imageBase64 is required" }, { status: 400 });
    }

    const image = stripDataUrlBase64(body.imageBase64);
    const payload = {
      image,
      texture: body.texture ?? false,
      remove_background: body.removeBackground ?? true,
      seed: body.seed ?? 1234,
    };

    if (body.asyncMode) {
      const sendRes = await fetch(`${baseUrl}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!sendRes.ok) {
        const t = await sendRes.text();
        return NextResponse.json(
          { error: `Hunyuan3D /send failed: ${sendRes.status}`, detail: t.slice(0, 2000) },
          { status: 502 },
        );
      }
      const json = (await sendRes.json()) as { uid?: string };
      if (!json.uid) {
        return NextResponse.json({ error: "No uid from Hunyuan3D /send", raw: json }, { status: 502 });
      }
      return NextResponse.json({ uid: json.uid, pollUrl: `${baseUrl}/status/${json.uid}` });
    }

    const genResult = await generateModel(baseUrl, payload);

    if (!genResult.ok) {
      if (payload.texture && body.fallbackToUntextured) {
        const fallbackResult = await generateModel(baseUrl, { ...payload, texture: false });
        if (fallbackResult.ok) {
          const b64 = Buffer.from(fallbackResult.buffer).toString("base64");
          return NextResponse.json({
            glbBase64: b64,
            mimeType: "model/gltf-binary",
            warning: `Textured generation failed, so the app generated an untextured mesh and will use the detected image color as a viewer tint. Original error: Hunyuan3D /generate failed: ${genResult.status}: ${genResult.detail}`,
            textureApplied: false,
          });
        }
      }

      const textureHint = payload.texture ? textureFailureHint(genResult.detail) : "";
      return NextResponse.json(
        { error: `Hunyuan3D /generate failed: ${genResult.status}`, detail: `${genResult.detail}${textureHint}` },
        { status: 502 },
      );
    }

    const b64 = Buffer.from(genResult.buffer).toString("base64");
    return NextResponse.json({
      glbBase64: b64,
      mimeType: "model/gltf-binary",
      textureApplied: payload.texture,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
