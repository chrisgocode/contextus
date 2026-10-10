// Google sign-in on a preview deployment comes back through production: Google
// only redirects to pre-registered URIs, and every preview backend has a new
// host. The OAuth `state` names the preview to forward to. CI signs it with a
// secret that previews never hold, so code running in a preview can't mint a
// state for another origin.
//
// State format: <base64url(origin)>.<base64url(HMAC-SHA256(secret, origin))>

const encoder = new TextEncoder();

export async function signPreviewState(
  secret: string,
  origin: string,
): Promise<string> {
  const originBytes = encoder.encode(origin);
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret, "sign"),
    originBytes,
  );
  return `${toBase64Url(originBytes)}.${toBase64Url(new Uint8Array(signature))}`;
}

/**
 * The origin a state names, only if its signature verifies and it is a bare
 * `https://*.convex.site` origin.
 */
export async function previewOriginFromState(
  secret: string | undefined,
  state: string | null,
): Promise<string | null> {
  // An empty secret would verify states anyone can sign.
  if (!secret || state === null) return null;
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const originBytes = fromBase64Url(parts[0]);
  const signature = fromBase64Url(parts[1]);
  if (originBytes === null || signature === null) return null;
  const verified = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret, "verify"),
    signature,
    originBytes,
  );
  if (!verified) return null;
  const origin = new TextDecoder().decode(originBytes);
  return isPreviewSiteOrigin(origin) ? origin : null;
}

// Checked even though the state is signed, so a leaked secret can't turn the
// forwarder into a redirect to any site.
function isPreviewSiteOrigin(origin: string): boolean {
  if (!URL.canParse(origin)) return false;
  const url = new URL(origin);
  return (
    url.protocol === "https:" &&
    url.hostname.endsWith(".convex.site") &&
    url.port === "" &&
    // Rules out a path, query, fragment or credentials.
    url.origin === origin
  );
}

function hmacKey(secret: string, usage: "sign" | "verify") {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}
