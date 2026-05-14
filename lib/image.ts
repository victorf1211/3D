/** Strip data URL prefix; return raw base64. */
export function stripDataUrlBase64(dataUrlOrB64: string): string {
  const m = /^data:image\/[^;]+;base64,(.+)$/i.exec(dataUrlOrB64.trim());
  return m ? m[1]! : dataUrlOrB64.replace(/\s/g, "");
}
