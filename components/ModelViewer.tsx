"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  src: string | null;
};

export function ModelViewer({ src }: Props) {
  const [ready, setReady] = useState(false);
  const loadedRef = useRef(false);

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
        Loading 3D viewer…
      </div>
    );
  }

  return (
    <model-viewer
      src={src}
      camera-controls
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
