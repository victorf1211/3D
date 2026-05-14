import { NextResponse } from "next/server";

export const maxDuration = 300;

export async function GET(
  _req: Request,
  context: { params: Promise<{ uid: string }> },
) {
  try {
    const baseUrl = process.env.HUNYUAN3D_BASE_URL?.replace(/\/$/, "");
    if (!baseUrl) {
      return NextResponse.json({ error: "HUNYUAN3D_BASE_URL not set" }, { status: 500 });
    }
    const { uid } = await context.params;
    if (!uid) {
      return NextResponse.json({ error: "uid required" }, { status: 400 });
    }

    const res = await fetch(`${baseUrl}/status/${encodeURIComponent(uid)}`);
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: `status failed: ${res.status}`, detail: text.slice(0, 2000) },
        { status: 502 },
      );
    }
    try {
      return NextResponse.json(JSON.parse(text) as unknown);
    } catch {
      return NextResponse.json({ error: "Invalid JSON from Hunyuan3D", detail: text.slice(0, 500) }, { status: 502 });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
