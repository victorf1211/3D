"use client";

import { useCallback, useMemo, useState } from "react";
import { ModelViewer } from "@/components/ModelViewer";

type Step = "idle" | "image" | "mesh" | "done";

const PIPELINE_STEPS = [
  { id: "user", label: "Your prompt", step: "prompt" as const },
  { id: "2d", label: "2D image", step: "image" as const },
  { id: "3d", label: "3D model (Hunyuan3D)", step: "mesh" as const },
] as const;

export default function HomePage() {
  const [prompt, setPrompt] = useState(
    "Single collectible toy rocket, matte plastic, soft studio lighting, centered, soft gray seamless background, product photo",
  );
  const [async3d, setAsync3d] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [userPromptSnapshot, setUserPromptSnapshot] = useState<string | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [glbObjectUrl, setGlbObjectUrl] = useState<string | null>(null);

  const pushLog = useCallback((line: string) => {
    setLog((prev) => [...prev, `${new Date().toISOString().slice(11, 19)}  ${line}`]);
  }, []);

  const busy = useMemo(() => step !== "idle" && step !== "done", [step]);

  const pipelineStepIndex = useMemo(() => {
    if (step === "idle") return -1;
    if (step === "image") return 1;
    if (step === "mesh") return 2;
    if (step === "done") return 3;
    return -1;
  }, [step]);

  const run = useCallback(async () => {
    setError(null);
    setLog([]);
    setImageDataUrl(null);
    setUserPromptSnapshot(null);
    if (glbObjectUrl) {
      URL.revokeObjectURL(glbObjectUrl);
      setGlbObjectUrl(null);
    }

    const trimmedUser = prompt.trim();
    if (!trimmedUser) {
      setError("Enter a prompt.");
      return;
    }

    setUserPromptSnapshot(trimmedUser);

    try {
      setStep("image");
      pushLog("Step 1→2: Generate 2D reference image from your prompt…");
      const ir = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmedUser }),
      });
      const ij = (await ir.json()) as {
        dataUrl?: string;
        imageBase64?: string;
        mimeType?: string;
        error?: string;
        detail?: string;
      };
      if (!ir.ok) {
        throw new Error(ij.error ?? "generate-image failed" + (ij.detail ? `: ${ij.detail}` : ""));
      }
      if (ij.dataUrl) {
        setImageDataUrl(ij.dataUrl);
      } else if (ij.imageBase64 && ij.mimeType) {
        setImageDataUrl(`data:${ij.mimeType};base64,${ij.imageBase64}`);
      } else {
        throw new Error("No image in response");
      }
      pushLog("2D image received.");

      setStep("mesh");
      pushLog("Step 2→3: Hunyuan3D — image → 3D mesh / GLB…");
      const mr = await fetch("/api/image-to-3d", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: ij.dataUrl ?? `data:${ij.mimeType};base64,${ij.imageBase64}`,
          texture: true,
          removeBackground: true,
          asyncMode: async3d,
        }),
      });
      const mj = (await mr.json()) as {
        glbBase64?: string;
        uid?: string;
        error?: string;
        detail?: string;
      };
      if (!mr.ok) throw new Error(mj.error ?? "image-to-3d failed" + (mj.detail ? `: ${mj.detail}` : ""));

      if (mj.glbBase64) {
        const bytes = Uint8Array.from(atob(mj.glbBase64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: "model/gltf-binary" });
        const url = URL.createObjectURL(blob);
        setGlbObjectUrl(url);
        pushLog("GLB ready.");
        setStep("done");
        return;
      }

      if (async3d && mj.uid) {
        pushLog(`Async job ${mj.uid}; polling…`);
        const deadline = Date.now() + 15 * 60_000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 2000));
          const sr = await fetch(`/api/hunyuan-status/${encodeURIComponent(mj.uid)}`);
          const sj = (await sr.json()) as {
            status?: string;
            model_base64?: string;
            error?: string;
          };
          if (!sr.ok) throw new Error(sj.error ?? "status poll failed");
          if (sj.status === "completed" && sj.model_base64) {
            const bytes = Uint8Array.from(atob(sj.model_base64), (c) => c.charCodeAt(0));
            const blob = new Blob([bytes], { type: "model/gltf-binary" });
            const url = URL.createObjectURL(blob);
            setGlbObjectUrl(url);
            pushLog("GLB ready (async).");
            setStep("done");
            return;
          }
          if (sj.status === "failed") {
            throw new Error("Hunyuan3D job failed");
          }
        }
        throw new Error("Timed out waiting for 3D job");
      }

      throw new Error("Unexpected 3D response");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      pushLog(`Error: ${msg}`);
      setStep("idle");
    }
  }, [async3d, glbObjectUrl, prompt, pushLog]);

  return (
    <main
      style={{
        maxWidth: 960,
        margin: "0 auto",
        padding: "48px 24px 80px",
      }}
    >
      <header style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 650, letterSpacing: "-0.02em", margin: "0 0 8px" }}>
          Your prompt → 2D image → 3D model
        </h1>
        <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.55, maxWidth: "72ch" }}>
          Your text prompt is sent to the configured image provider for a 2D reference, then{" "}
          <strong style={{ color: "var(--text)", fontWeight: 600 }}>Hunyuan3D</strong> builds a 3D mesh (GLB) from
          that image. Set <code style={{ fontSize: "0.9em" }}>HUNYUAN3D_BASE_URL</code> for your Hunyuan3D API
          server.
        </p>
      </header>

      <nav
        aria-label="Pipeline progress"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "8px 12px",
          marginBottom: 24,
          padding: "14px 16px",
          borderRadius: "var(--radius)",
          border: "1px solid var(--border)",
          background: "var(--surface)",
          fontSize: "0.85rem",
          color: "var(--muted)",
        }}
      >
        {PIPELINE_STEPS.map((s, i) => {
          const active =
            (s.step === "image" && step === "image") ||
            (s.step === "mesh" && (step === "mesh" || step === "done"));
          const done = pipelineStepIndex > i || (step === "done" && i < 3);
          return (
            <span key={s.id} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              {i > 0 && <span style={{ opacity: 0.45 }}>→</span>}
              <span
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  fontWeight: 600,
                  color: active ? "#fff" : done ? "var(--text)" : "var(--muted)",
                  background: active ? "var(--accent-dim)" : done ? "rgba(90,124,255,0.15)" : "transparent",
                  border: active || done ? "1px solid var(--accent-dim)" : "1px solid var(--border)",
                }}
              >
                {i + 1}. {s.label}
              </span>
            </span>
          );
        })}
      </nav>

      <section
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: 20,
          marginBottom: 24,
        }}
      >
        <label style={{ display: "block", fontSize: "0.85rem", color: "var(--muted)", marginBottom: 8 }}>
          Your prompt (idea)
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          disabled={busy}
          style={{
            width: "100%",
            resize: "vertical",
            padding: 12,
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "#0b0c0f",
            color: "var(--text)",
            fontFamily: "inherit",
            fontSize: "0.95rem",
            lineHeight: 1.45,
          }}
        />

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            marginTop: 16,
            alignItems: "center",
          }}
        >
          <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: busy ? "default" : "pointer" }}>
            <input type="checkbox" checked={async3d} disabled={busy} onChange={(e) => setAsync3d(e.target.checked)} />
            <span>Hunyuan3D async (/send + poll)</span>
          </label>
        </div>

        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          style={{
            marginTop: 18,
            padding: "12px 20px",
            borderRadius: 10,
            border: "1px solid var(--accent-dim)",
            background: busy ? "var(--border)" : "linear-gradient(180deg, #5a7cff 0%, var(--accent-dim) 100%)",
            color: "#fff",
            fontWeight: 600,
            fontSize: "0.95rem",
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "Running…" : "Run pipeline"}
        </button>

        {userPromptSnapshot && (
          <p style={{ marginTop: 16, fontSize: "0.9rem", color: "var(--muted)", lineHeight: 1.5 }}>
            <span style={{ color: "var(--text)", fontWeight: 600 }}>Your prompt:</span> {userPromptSnapshot}
          </p>
        )}

        {error && (
          <p
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: 8,
              background: "#2a1518",
              border: "1px solid #5c2a32",
              color: "#ffb4bc",
              fontSize: "0.9rem",
            }}
          >
            {error}
          </p>
        )}
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <section>
          <h2 style={{ fontSize: "1rem", margin: "0 0 12px", fontWeight: 600 }}>2D preview</h2>
          {imageDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageDataUrl}
              alt="Generated reference"
              style={{
                width: "100%",
                borderRadius: "var(--radius)",
                border: "1px solid var(--border)",
                display: "block",
              }}
            />
          ) : (
            <div
              style={{
                height: 280,
                borderRadius: "var(--radius)",
                border: "1px dashed var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--muted)",
                fontSize: "0.9rem",
              }}
            >
              No image yet
            </div>
          )}
        </section>
        <section>
          <h2 style={{ fontSize: "1rem", margin: "0 0 12px", fontWeight: 600 }}>3D preview (Hunyuan3D)</h2>
          <ModelViewer src={glbObjectUrl} />
          {!glbObjectUrl && (
            <div
              style={{
                height: 420,
                borderRadius: "var(--radius)",
                border: "1px dashed var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--muted)",
                fontSize: "0.9rem",
              }}
            >
              No model yet
            </div>
          )}
        </section>
      </div>

      {log.length > 0 && (
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: "1rem", margin: "0 0 12px", fontWeight: 600 }}>Log</h2>
          <pre
            style={{
              margin: 0,
              padding: 16,
              borderRadius: "var(--radius)",
              border: "1px solid var(--border)",
              background: "#0b0c0f",
              color: "var(--muted)",
              fontSize: "0.8rem",
              lineHeight: 1.5,
              overflow: "auto",
              maxHeight: 220,
            }}
          >
            {log.join("\n")}
          </pre>
        </section>
      )}
    </main>
  );
}
