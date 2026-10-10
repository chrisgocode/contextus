# Label-gated PR previews, with Google sign-in forwarded through production

A pull request labelled `preview` is deployed to its own Convex preview backend and a Vercel preview by `.github/workflows/preview.yml`. This replaces the "no PR preview deployments" consequence of [ADR 0003](0003-batched-releases.md): Vercel's Git deployments stay off, and previews come from GitHub Actions like production does.

- **A label, not every PR:** each preview is a Vercel deployment, and the Hobby plan allows 100 a day. The label is added by someone with write access, which also decides which PRs run with deploy secrets.
- **Real Google sign-in, forwarded through production:** Google only redirects to pre-registered URIs, every Convex preview backend has a new host, and `@convex-dev/auth` 0.0.95 has no redirect-proxy support. So a preview sends Google to one fixed route on production, `/api/preview-oauth/callback/google`, which redirects on to the preview's own callback with the query unchanged. Production writes no rows and holds no preview credentials. Password sign-in and `E2E_TEST` were rejected: `E2E_TEST` also swaps in the fake word oracle and one-hour Guests, so the preview would not behave like production.
- **CI signs the state, not the preview:** the OAuth `state` names the preview to forward to and is signed with `PREVIEW_OAUTH_STATE_SECRET`, held only by production and GitHub secrets. PR code running in a preview holds its own state and cannot mint one for another origin.
- **App code over a library patch:** the preview-side overrides (`convex/lib/previewGoogle.ts`) use Convex Auth's existing seams: `authorization.params`, the `customFetch` hook, and the `auth:store` override that already starts Guest merges.
- **A separate Google OAuth client for previews,** so production's client secret is never in a deployment running PR code. Previews also have their own JWT key pair.

## Consequences

The overrides depend on three behaviours of the installed Convex Auth: params landing on the Google URL, `customFetch` being read from the provider object, and the format of the verifier signature. `convex/tests/previewGoogle.test.ts` runs them through the library's own sign-in and callback steps, so an upgrade that breaks preview sign-in fails CI. It cannot break production sign-in, which takes neither path.

On a preview, the OAuth `state` is fixed per deployment, not random per sign-in. Convex Auth never checked state for Google; PKCE is what ties a callback to the browser that started it, and that is unchanged.

`PREVIEW_OAUTH_CALLBACK_URL` and `PREVIEW_OAUTH_STATE` must never be set on production, or real sign-ins would go through the forwarder. `PREVIEW_OAUTH_STATE_SECRET` must never be added to the preview defaults, or a preview could sign a state for any origin.

The preview job runs PR code (install scripts, the build) with `VERCEL_TOKEN`, which can also deploy production. Only branches in this repo reach it, and only once labelled; fork PRs get no preview. Label a PR only after reading its diff.

Removing the label, or closing or merging the PR, deletes the preview: the Convex backend through the Management API, which accepts the preview deploy key for previews in its own project, and every Vercel deployment tagged with the PR. Convex allows a team 40 deployments, so previews left to expire could block new ones. The CLI has no delete command, and the delete endpoint needs the backend's generated name, so the cleanup job looks it up with the request the CLI makes for `--preview-name`. That request is not part of the documented API. If it changes, the job fails and the backend waits for Convex's own expiry.

Convex deletes a preview backend 5 days after it is created on the Free and Starter plans, whether or not the PR is still open. A labelled PR open for longer loses its backend, and its data, until the next push or re-label creates a new one. A preview backend is public to anyone who has its URL, whatever Vercel's Deployment Protection is set to.
