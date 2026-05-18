"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  src: string | null;
  color?: string;
  applyColor?: boolean;
};

type ModelViewerElement = HTMLElement & {
  updateComplete?: Promise<void>;
  model?: {
    materials?: Array<{
      pbrMetallicRoughness?: {
        setBaseColorFactor?: (color: [number, number, number, number]) => void;
      };
    }>;
  };
};

function hexToRgba(hex: string): [number, number, number, number] {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16) / 255;
  const g = Number.parseInt(value.slice(2, 4), 16) / 255;
  const b = Number.parseInt(value.slice(4, 6), 16) / 255;

  return [r, g, b, 1];
}

export function ModelViewer({ src, color = "#ffffff", applyColor: shouldApplyColor = false }: Props) {
  const [ready, setReady] = useState(false);
  const loadedRef = useRef(false);
  const viewerRef = useRef<ModelViewerElement | null>(null);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    const existing = document.querySelector('script[data-model-viewer="1"]');
    if (existing) {
      setReady(true);
      return;
    }
    const s = document.createElement("script");
    s.type = "module";
    s.src = "https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js";
    s.setAttribute("data-model-viewer", "1");
    s.onload = () => setReady(true);
    s.onerror = () => setReady(false);
    document.head.appendChild(s);
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !src || !shouldApplyColor) return;

    const applyColor = () => {
      const rgba = hexToRgba(color);
      viewer.model?.materials?.forEach((material) => {
        material.pbrMetallicRoughness?.setBaseColorFactor?.(rgba);
      });
    };

    const applyWhenReady = () => {
      void viewer.updateComplete?.then(applyColor);
      applyColor();
      requestAnimationFrame(applyColor);
      window.setTimeout(applyColor, 100);
      window.setTimeout(applyColor, 500);
    };

    applyWhenReady();
    viewer.addEventListener("load", applyColor);
    viewer.addEventListener("model-visibility", applyColor);

    return () => {
      viewer.removeEventListener("load", applyColor);
      viewer.removeEventListener("model-visibility", applyColor);
    };
  }, [shouldApplyColor, color, src, ready]);

  if (!src) return null;

  if (!ready) {
    return (
      <div
        style={{
          height: 360,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          color: "var(--muted)",
        }}
      >
        Loading 3D viewer...
      </div>
    );
  }

  return (
    <model-viewer
      ref={viewerRef}
      src={src}
      camera-controls
      auto-rotate
      shadow-intensity="1"
      exposure="1"
      environment-image="neutral"
      style={{
        width: "100%",
        height: 420,
        borderRadius: "var(--radius)",
        background: "linear-gradient(180deg, #1a1d26 0%, #0f1116 100%)",
        border: "1px solid var(--border)",
      }}
    />
  );
}
