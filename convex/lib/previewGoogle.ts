import { customFetch } from "@auth/core";
import Google from "@auth/core/providers/google";

// The preview side of Google sign-in forwarded through production (see
// previewOAuth.ts). Convex Auth has no redirect-proxy support, so these lean
// on three of its behaviours: `authorization.params` landing on the Google
// URL, the `customFetch` hook, and the verifier signature format.
// tests/previewGoogle.test.ts runs them through the library, so an upgrade
// that changes one fails CI.

/**
 * The Google provider for a preview deployment: Google redirects to
 * production's forwarder, carrying the state that names this preview.
 */
export function previewGoogle(forwardUrl: string, state: string) {
  return {
    ...Google({
      authorization: { params: { redirect_uri: forwardUrl, state } },
    }),
    // Convex Auth rebuilds redirect_uri from this deployment's URL for the
    // code exchange; Google requires the one it redirected to. This must be
    // on the provider object: inside `Google({...})` it is dropped, because
    // Convex Auth merges options with `for...in`, which skips symbol keys.
    [customFetch]: (input: RequestInfo | URL, init?: RequestInit) => {
      if (
        init?.body instanceof URLSearchParams &&
        init.body.has("redirect_uri")
      ) {
        init.body.set("redirect_uri", forwardUrl);
      }
      return fetch(input, init);
    },
  };
}

/**
 * The verifier signature as the callback will compute it. Convex Auth signs
 * "<pkce> <state>" on the sign-in leg because the state is on the URL, but
 * only "<pkce>" on the callback, since Google's checks don't include state.
 */
export function callbackSignature(signature: string, state: string): string {
  return signature.replace(` ${state}`, "");
}
