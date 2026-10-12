// Dekódování textu exportů.

/** Text CSV: UTF-8, a pokud v něm nejsou platné znaky UTF-8, Windows-1250 (starší exporty z Excelu). */
export function decodeText(buffer: ArrayBuffer | Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1250').decode(buffer);
  }
}
