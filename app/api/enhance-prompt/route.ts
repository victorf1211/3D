import { NextResponse } from "next/server";
import { getOpenAI, getOpenAITextModel } from "@/lib/openai";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { prompt } = (await req.json()) as { prompt?: string };
    if (!prompt?.trim()) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    const openai = getOpenAI();
    const model = getOpenAITextModel();

    const system = `You rewrite short user ideas into ONE English prompt for a text-to-image model (the next step). That image will be fed to image-to-3D, so optimize for: one clear subject, full object visible, centered, unambiguous silhouette, realistic or stylized materials as appropriate, soft even lighting, simple or seamless neutral background, no text/watermarks, no collage, no multiple unrelated objects.

Output rules: reply with ONLY the improved image prompt—no title, no quotes, no preamble, no bullet list.`;

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt.trim() },
      ],
      temperature: 0.7,
    });

    const text = completion.choices[0]?.message?.content?.trim() ?? "";

    if (!text) {
      return NextResponse.json(
        { error: "Model returned no text. Check OPENAI_TEXT_MODEL and billing." },
        { status: 502 },
      );
    }

    return NextResponse.json({ enhancedPrompt: text, model });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
