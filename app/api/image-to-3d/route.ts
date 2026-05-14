import { NextResponse } from "next/server";
import { stripDataUrlBase64 } from "@/lib/image";

export const maxDuration = 300;

type Body = {
  imageBase64?: string;
  texture?: boolean;
  removeBackground?: boolean;
  seed?: number;
  asyncMode?: boolean;
};

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
      texture: body.texture ?? true,
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

    const genRes = await fetch(`${baseUrl}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!genRes.ok) {
      const t = await genRes.text();
      return NextResponse.json(
        { error: `Hunyuan3D /generate failed: ${genRes.status}`, detail: t.slice(0, 2000) },
        { status: 502 },
      );
    }

    const contentType = genRes.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const json = (await genRes.json()) as Record<string, unknown>;
      return NextResponse.json({ message: "Unexpected JSON from /generate", raw: json }, { status: 502 });
    }

    const buf = await genRes.arrayBuffer();
    const b64 = Buffer.from(buf).toString("base64");
    return NextResponse.json({
      glbBase64: b64,
      mimeType: "model/gltf-binary",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
