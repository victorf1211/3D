import { NextResponse } from "next/server";
import { getOpenAI, getOpenAIImageModel, getOpenAIImageSize } from "@/lib/openai";
import { resolveFlexibleGeneratedImage, resolveGeneratedImageBytes } from "@/lib/openaiGeneratedImage";
import { wangsuChatImageRequest } from "@/lib/wangsuImage";

export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const provider = process.env.IMAGE_PROVIDER?.trim().toLowerCase() ?? "openai";
    const { prompt } = (await req.json()) as { prompt?: string };
    if (!prompt?.trim()) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    if (provider === "wangsu") {
      const raw = await wangsuChatImageRequest(prompt.trim());
      const resolved = await resolveFlexibleGeneratedImage(raw);
      if (!resolved) {
        return NextResponse.json(
          {
            error:
              "Wangsu returned JSON but no recognizable image field. Check gateway response shape or docs.",
          },
          { status: 502 },
        );
      }
      const model = process.env.WANGSU_GENERATE_MODEL?.trim() || "gpt-image-2";
      return NextResponse.json({
        imageBase64: resolved.imageBase64,
        mimeType: resolved.mimeType,
        dataUrl: resolved.dataUrl,
        model,
      });
    }

    if (provider !== "openai") {
      return NextResponse.json(
        {
          error: `IMAGE_PROVIDER=${provider} is not supported. Use openai or wangsu.`,
        },
        { status: 501 },
      );
    }

    const openai = getOpenAI();
    const model = getOpenAIImageModel();
    const size = getOpenAIImageSize();

    let img: Awaited<ReturnType<typeof openai.images.generate>>;
    try {
      img = await openai.images.generate({
        model,
        prompt: prompt.trim(),
        n: 1,
        size,
        response_format: "b64_json",
      });
    } catch (first) {
      const msg = first instanceof Error ? first.message : String(first);
      const maybeFormatRejected =
        /response_format|b64_json|unsupported|not support|不支持|unknown parameter/i.test(msg);
      if (!maybeFormatRejected) throw first;
      img = await openai.images.generate({
        model,
        prompt: prompt.trim(),
        n: 1,
        size,
      });
    }

    const resolved = await resolveGeneratedImageBytes(img);
    if (!resolved) {
      const item = img.data?.[0];
      const detail =
        typeof item?.revised_prompt === "string" ? item.revised_prompt.slice(0, 500) : undefined;
      return NextResponse.json(
        {
          error: "No image in OpenAI response. Check OPENAI_IMAGE_MODEL and API access.",
          detail,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      imageBase64: resolved.imageBase64,
      mimeType: resolved.mimeType,
      dataUrl: resolved.dataUrl,
      model,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
