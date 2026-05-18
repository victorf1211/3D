import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prompt -> 2D -> 3D",
  description: "OpenAI refines prompts and generates 2D images; Hunyuan3D turns them into 3D assets.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
