import { fileURLToPath } from "url";
// A TypeScript import, so run this with Bun or Node 22.18+.
import {
  previewOriginFromState,
  signPreviewState,
} from "../convex/lib/previewOAuth.ts";

/**
 * The signed OAuth state for a preview deployment's site origin, which CI sets
 * as the preview's `PREVIEW_OAUTH_STATE`. Throws for an origin production's
 * forwarder would refuse, so a bad one fails the workflow, not a sign-in.
 *
 * @param {string | undefined} secret
 * @param {string | undefined} origin
 */
export async function previewState(secret, origin) {
  if (!secret) throw new Error("PREVIEW_OAUTH_STATE_SECRET is not set.");
  if (!origin) {
    throw new Error("Usage: sign-preview-state.mjs <preview site origin>");
  }
  const state = await signPreviewState(secret, origin);
  if ((await previewOriginFromState(secret, state)) !== origin) {
    throw new Error(`Not a bare https://*.convex.site origin: ${origin}`);
  }
  return state;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    // The secret comes from the environment, never argv, which other
    // processes can read.
    const state = await previewState(
      process.env.PREVIEW_OAUTH_STATE_SECRET,
      process.argv[2],
    );
    console.log(state);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
