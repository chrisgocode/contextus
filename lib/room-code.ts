/** Path of the room page for a typed room code, or Home when it's blank. */
export function roomPath(code: string): string {
  const normalized = code.trim().toUpperCase();
  return normalized ? `/r/${encodeURIComponent(normalized)}` : "/";
}
