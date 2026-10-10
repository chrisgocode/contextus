import { customFetch } from "@auth/core";
import Google from "@auth/core/providers/google";

// The preview side of Google sign-in forwarded through production (see
// previewOAuth.ts). Convex Auth has no redirect-proxy support, so these lean
// on three of its behaviours: `authorization.params` landing on the Google
// URL, the `customFetch` hook, and the verifier signature format.
// tests/previewGoogle.test.ts runs them through the library, so an upgrade
// that changes one fails CI.

/** The Google provider for this deployment's environment. */
export function googleProvider(env: {
  E2E_TEST?: string;
  E2E_GOOGLE_ISSUER?: string;
  PREVIEW_OAUTH_CALLBACK_URL?: string;
  PREVIEW_OAUTH_STATE?: string;
}) {
  // E2E runs sign in with Google against `e2e/oidc-mock.mjs`.
  if (env.E2E_TEST === "1" && env.E2E_GOOGLE_ISSUER !== undefined) {
    return Google({ issuer: env.E2E_GOOGLE_ISSUER });
  }
  // PR previews sign in through production's forwarder. CI sets both.
  if (
    env.PREVIEW_OAUTH_CALLBACK_URL !== undefined &&
    env.PREVIEW_OAUTH_STATE !== undefined
  ) {
    return previewGoogle(
      env.PREVIEW_OAUTH_CALLBACK_URL,
      env.PREVIEW_OAUTH_STATE,
    );
  }
  return Google;
}

/**
 * The Google provider for a preview deployment: Google redirects to
 * production's forwarder, carrying the state that names this preview.
 */
function previewGoogle(forwardUrl: string, state: string) {
  return {
    ...Google({
      authorization: { params: { redirect_uri: forwardUrl, state } },
    }),
    // Convex Auth rebuilds redirect_uri from this deployment's URL for the
    // code exchange; Google requires the one it redirected to. This must be
    // on the provider object: inside `Google({...})` it is dropped, because
    // Convex Auth merges options with `for...in`, which skips symbol keys.
    [customFetch]: async (input: RequestInfo | URL, init?: RequestInit) => {
      const isCodeExchange =
        init?.body instanceof URLSearchParams && init.body.has("redirect_uri");
      if (isCodeExchange) {
        (init.body as URLSearchParams).set("redirect_uri", forwardUrl);
      }
      const response = await fetch(input, init);
      // Convex Auth logs a failed exchange without Google's reason. The body
      // of an error holds only an error code and description, no secrets.
      if (isCodeExchange && !response.ok) {
        // Convex Auth sends "decoy" when the browser didn't return the PKCE
        // cookie, which is the part of this flow the extra redirect puts at
        // risk.
        const verifier = (init.body as URLSearchParams).get("code_verifier");
        const pkceCookie = verifier === "decoy" ? "missing" : "present";
        console.error(
          `Google rejected the preview code exchange (${response.status}, PKCE cookie ${pkceCookie}): ${await response.clone().text()}`,
        );
      }
      return response;
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
