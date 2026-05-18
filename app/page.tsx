"use client";

import { ChangeEvent, useCallback, useMemo, useState } from "react";
import { ModelViewer } from "@/components/ModelViewer";

type Step = "idle" | "image" | "mesh" | "done";
type ReferenceMode = "generate" | "upload";

const DEFAULT_MODEL_COLOR = "#ffffff";

const PIPELINE_STEPS = [
  { id: "user", label: "Reference source", step: "prompt" as const },
  { id: "2d", label: "2D image", step: "image" as const },
  { id: "3d", label: "3D model (Hunyuan3D)", step: "mesh" as const },
] as const;

export default function HomePage() {
  const [prompt, setPrompt] = useState(
    "Single collectible toy rocket, matte plastic, soft studio lighting, centered, soft gray seamless background, product photo",
  );
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>("generate");
  const [uploadedImageDataUrl, setUploadedImageDataUrl] = useState<string | null>(null);
  const [async3d, setAsync3d] = useState(false);
  const [modelColor, setModelColor] = useState(DEFAULT_MODEL_COLOR);
  const [applyFallbackColor, setApplyFallbackColor] = useState(true);
  const [userTintActive, setUserTintActive] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
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

  const handleUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      return;
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Could not read uploaded image"));
      reader.readAsDataURL(file);
    });

    setError(null);
    setUploadedImageDataUrl(dataUrl);
    setImageDataUrl(dataUrl);
  }, []);

  const run = useCallback(async () => {
    setError(null);
    setLog([]);
    setUserPromptSnapshot(null);
    if (referenceMode === "generate") setImageDataUrl(null);
    if (glbObjectUrl) {
      URL.revokeObjectURL(glbObjectUrl);
      setGlbObjectUrl(null);
    }
    setShowColorPicker(false);
    setUserTintActive(false);
    setModelColor(DEFAULT_MODEL_COLOR);

    const trimmedUser = prompt.trim();
    if (referenceMode === "generate" && !trimmedUser) {
      setError("Enter a prompt.");
      return;
    }
    if (referenceMode === "upload" && !uploadedImageDataUrl) {
      setError("Upload a 2D reference image.");
      return;
    }

    setUserPromptSnapshot(referenceMode === "generate" ? trimmedUser : "Uploaded 2D reference image");

    try {
      setStep("image");
      let referenceImageDataUrl = uploadedImageDataUrl;

      if (referenceMode === "generate") {
        pushLog("Step 1 -> 2: Generate a 2D reference image from your prompt.");
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
        referenceImageDataUrl =
          ij.dataUrl ?? (ij.imageBase64 && ij.mimeType ? `data:${ij.mimeType};base64,${ij.imageBase64}` : null);
        if (!referenceImageDataUrl) {
          throw new Error("No image in response");
        }
        setImageDataUrl(referenceImageDataUrl);
        pushLog("2D image received.");
      } else {
        pushLog("Step 1 -> 2: Using uploaded 2D reference image.");
      }

      if (!referenceImageDataUrl) throw new Error("No 2D reference image available");

      setStep("mesh");
      pushLog("Step 2 -> 3: Hunyuan3D image -> textured 3D mesh / GLB.");
      const mr = await fetch("/api/image-to-3d", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: referenceImageDataUrl,
          texture: true,
          removeBackground: true,
          asyncMode: async3d,
          fallbackToUntextured: true,
        }),
      });
      const mj = (await mr.json()) as {
        glbBase64?: string;
        uid?: string;
        warning?: string;
        textureApplied?: boolean;
        error?: string;
        detail?: string;
      };
      if (!mr.ok) throw new Error(`${mj.error ?? "image-to-3d failed"}${mj.detail ? `: ${mj.detail}` : ""}`);

      if (mj.glbBase64) {
        const bytes = Uint8Array.from(atob(mj.glbBase64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: "model/gltf-binary" });
        const url = URL.createObjectURL(blob);
        setGlbObjectUrl(url);
        if (mj.warning) pushLog(mj.warning);
        if (mj.textureApplied === false) {
          setModelColor(DEFAULT_MODEL_COLOR);
          setUserTintActive(true);
          pushLog("Untextured GLB ready; applying white tint in the viewer.");
        } else {
          pushLog("Textured GLB ready; use Change color next to the model to tint if needed.");
        }
        pushLog("GLB ready.");
        setStep("done");
        return;
      }

      if (async3d && mj.uid) {
        pushLog(`Async job ${mj.uid}; polling...`);
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
            pushLog("Async textured GLB ready.");
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
  }, [async3d, glbObjectUrl, prompt, pushLog, referenceMode, uploadedImageDataUrl]);

  const applyModelTint = applyFallbackColor || userTintActive;

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "48px 24px 80px" }}>
      <header style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 650, margin: "0 0 8px" }}>
          Your prompt {"->"} 2D image {"->"} 3D model
        </h1>
        <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.55, maxWidth: "72ch" }}>
          Generate a 2D reference or upload your own image, then{" "}
          <strong style={{ color: "var(--text)", fontWeight: 600 }}>Hunyuan3D</strong> builds a textured GLB from it.
          After the model loads, use <strong style={{ color: "var(--text)", fontWeight: 600 }}>Change color</strong> next to
          the 3D preview to tint the mesh.
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
              {i > 0 && <span style={{ opacity: 0.45 }}>-&gt;</span>}
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
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {(["generate", "upload"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setReferenceMode(mode)}
              disabled={busy}
              aria-pressed={referenceMode === mode}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: `1px solid ${referenceMode === mode ? "var(--accent)" : "var(--border)"}`,
                background: referenceMode === mode ? "rgba(124,156,255,0.16)" : "#0b0c0f",
                color: referenceMode === mode ? "var(--text)" : "var(--muted)",
                cursor: busy ? "not-allowed" : "pointer",
                fontWeight: 600,
              }}
            >
              {mode === "generate" ? "Generate image" : "Upload image"}
            </button>
          ))}
        </div>

        {referenceMode === "generate" ? (
          <>
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
          </>
        ) : (
          <label
            style={{
              display: "block",
              padding: 16,
              borderRadius: 8,
              border: "1px dashed var(--border)",
              background: "#0b0c0f",
              color: "var(--muted)",
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            <span style={{ display: "block", marginBottom: 8, color: "var(--text)", fontWeight: 600 }}>
              Upload 2D reference image
            </span>
            <input type="file" accept="image/*" disabled={busy} onChange={(e) => void handleUpload(e)} />
          </label>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 16, alignItems: "center" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: busy ? "default" : "pointer" }}>
            <input type="checkbox" checked={async3d} disabled={busy} onChange={(e) => setAsync3d(e.target.checked)} />
            <span>Hunyuan3D async (/send + poll)</span>
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: busy ? "default" : "pointer" }}>
            <input
              type="checkbox"
              checked={applyFallbackColor}
              disabled={busy}
              onChange={(e) => setApplyFallbackColor(e.target.checked)}
            />
            <span>Apply white tint to untextured models</span>
            <span
              aria-label={`Model tint color ${modelColor}`}
              title={`Model tint color ${modelColor}`}
              style={{
                width: 18,
                height: 18,
                borderRadius: 5,
                border: "1px solid var(--border)",
                background: modelColor,
              }}
            />
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
          {busy ? "Running..." : "Run pipeline"}
        </button>

        {userPromptSnapshot && (
          <p style={{ marginTop: 16, fontSize: "0.9rem", color: "var(--muted)", lineHeight: 1.5 }}>
            <span style={{ color: "var(--text)", fontWeight: 600 }}>Reference:</span> {userPromptSnapshot}
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
        <section>
          <h2 style={{ fontSize: "1rem", margin: "0 0 12px", fontWeight: 600 }}>2D preview</h2>
          {imageDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageDataUrl}
              alt="2D reference"
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 12,
              flexWrap: "wrap",
            }}
          >
            <h2 style={{ fontSize: "1rem", margin: 0, fontWeight: 600 }}>3D preview (Hunyuan3D)</h2>
            {glbObjectUrl && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowColorPicker((open) => !open);
                    setUserTintActive(true);
                  }}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: showColorPicker ? "rgba(124,156,255,0.16)" : "#0b0c0f",
                    color: "var(--text)",
                    fontWeight: 600,
                    fontSize: "0.85rem",
                    cursor: "pointer",
                  }}
                >
                  Change color
                </button>
                {showColorPicker && (
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 10px",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "#0b0c0f",
                      cursor: "pointer",
                      fontSize: "0.85rem",
                      color: "var(--muted)",
                    }}
                  >
                    <input
                      type="color"
                      value={modelColor}
                      onChange={(e) => {
                        setModelColor(e.target.value);
                        setUserTintActive(true);
                      }}
                      style={{
                        width: 36,
                        height: 28,
                        padding: 0,
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                      }}
                      aria-label="Pick model color"
                    />
                    {modelColor}
                  </label>
                )}
                <span
                  aria-hidden
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: modelColor,
                    boxShadow: applyModelTint ? `0 0 0 2px ${modelColor}55` : undefined,
                  }}
                />
              </div>
            )}
          </div>
          <ModelViewer src={glbObjectUrl} color={modelColor} applyColor={applyModelTint} />
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
