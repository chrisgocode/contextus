# E2E testing Google sign-in (Guest merge)

**Question:** How can Playwright test a Guest who signs in through the real
Google OAuth path (`auth:store` `userOAuth` branch) and keeps their data?

**Answer:** Point Convex Auth's Google provider at a mock OIDC issuer when
`E2E_TEST=1`, run [`oauth2-mock-server`][oms] next to the local Convex backend,
and drive the real "Continue with Google" button. The resulting test passes
with #133's fix and fails on `main` (`played: 0`), so it tests the Google
merge branch that production uses.

Versions checked: `@convex-dev/auth` 0.0.95, `@auth/core` 0.41.3,
`oauth4webapi` 3.8.6, `oauth2-mock-server` 9.2.0.

## How Convex Auth runs Google sign-in

Everything below happens on the Convex backend. The browser only follows
redirects.

1. `signIn("google")` runs `handleOAuthProvider`. It calls `auth:store`
   `verifier` while the Guest is still authenticated, which saves the Guest's
   session id on a new `authVerifiers` row. The page is then redirected to
   `CONVEX_SITE_URL/api/auth/signin/google`
   (`dist/server/implementation/signIn.js`, `mutations/verifier.js`).
2. The HTTP action resolves the provider's endpoints. If the provider doesn't
   define `authorization`, `token` and `userinfo` itself, Convex Auth fetches
   `{issuer}/.well-known/openid-configuration` with
   `o.allowInsecureRequests: true`, so an `http://localhost` issuer is accepted
   (`dist/server/oauth/convexAuth.js`, `oAuthConfigToInternalProvider`).
3. The redirect to the IdP carries PKCE (S256), `state` and `nonce`.
   `scope=openid profile email` is added for `oidc` providers. Convex Auth
   stores the joined values as the verifier row's `signature`
   (`oauth/authorizationUrl.js`, `getAuthorizationSignature`).
4. The callback at `/api/auth/callback/google` exchanges the code with the
   token endpoint (server to server, again allowing insecure requests) and
   checks the nonce. It then reads the profile from the ID token claims
   (`oauth/callback.js`). This is where `auth:store` `userOAuth` runs, which
   #133 wraps.
5. The browser comes back to the app with `?code=`. The Next middleware swaps
   that code for tokens through `auth:signIn`, with no token attached.

Step 4 is the one that has to be real. It is a server-to-server call from the
Convex backend, so the IdP must be reachable from the backend.

## Pointing Google at a mock issuer

`@auth/core`'s `Google()` is only
`{ id: "google", type: "oidc", issuer: "https://accounts.google.com", options }`,
and Convex Auth deep-merges `options` over it (`provider_utils.js`,
`providerDefaults` → `merge(provider, provider.options)`). So
`Google({ issuer })` replaces the issuer while keeping the provider id
`google`. The id matters because it is stored as `authAccounts.provider` and
is part of the callback URL.

`AUTH_GOOGLE_ISSUER` does **not** work. `setEnvDefaults` only fills in
`issuer` when the provider doesn't set one (`finalProvider.issuer ??= issuer`
in `@auth/core/lib/utils/env.js`), and `Google()` always sets it. The override
therefore has to happen in code:

```ts
// convex/auth.ts
env.E2E_TEST === "1" && env.E2E_GOOGLE_ISSUER !== undefined
  ? Google({ issuer: env.E2E_GOOGLE_ISSUER })
  : Google,
```

Guard it with `E2E_TEST`, as `Password` is already guarded, so a stray
`E2E_GOOGLE_ISSUER` can never redirect production sign-ins. Declare
`E2E_GOOGLE_ISSUER: v.optional(v.string())` in `convex/convex.config.ts`.
`AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` can be any values: the mock doesn't
check client credentials.

A separate e2e-only provider with a different id would test less. The merge
code keys the target account on `args.provider`, and the real branch only runs
for `google`.

## Mock IdP options

| Option                                             | Runs in CI                                     | PKCE / nonce                                                                                                     | Choosing the user per test                                                                                                          | Cost                                              |
| -------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| [`oauth2-mock-server`][oms] (npm, axa-group, MIT)  | `node` process, no Docker                      | S256 PKCE checked; `nonce` echoed into the ID token (source: `oauth2-server-*.mjs`, `#codeChallenges`, `#nonce`) | `/authorize` redirects straight back with no login page; `beforeTokenSigning` and `beforeAuthorizeRedirect` hooks set `sub`/`email` | One dev dependency and a ~20-line script          |
| [`navikt/mock-oauth2-server`][navikt] (Docker/JVM) | `docker run ghcr.io/navikt/mock-oauth2-server` | README says nothing about PKCE or nonce                                                                          | `interactiveLogin` page; `tokenCallbacks` map the typed username to claims                                                          | Docker service in CI, JVM image pull              |
| Keycloak / Dex                                     | Docker                                         | Full                                                                                                             | Real login forms and seeded users                                                                                                   | Heavy: realm/connector config, slow start         |
| Route inside the Next app                          | Needs no extra process                         | We would write PKCE, nonce, JWKS and ID token signing ourselves                                                  | Anything                                                                                                                            | Custom crypto to maintain; a test of our own mock |

**Recommendation: `oauth2-mock-server`.** It is the only lightweight option
whose source shows it checks PKCE and returns the nonce, and both are checks
`oauth4webapi` enforces. The default `sub` is always `johndoe`, so a hook has
to give each test its own identity. Otherwise every worker signs in to the
same account.

The first prototype passed the identity through a cookie on the mock's
origin. It was flaky under parallel runs for two reasons, and the final mock
(`e2e/oidc-mock.mjs`) avoids both:

- **`beforeTokenSigning` runs twice per code exchange**, once for the access
  token and once for the ID token. Removing the code's identity after the
  first call left the ID token, which is the one Convex Auth reads, with the
  default `sub`. The mapping now stays.
- **The mock's `/authorize` redirected straight back.** The whole redirect
  chain then finished while the Guest's `/signin` page was still loaded. Once
  the merge deleted the Guest, that page's `StaleSessionSignOut` called
  `signOut`, and by then the shared cookie held the _new_ account's token, so
  it signed the new account out. Google shows a page first, which unloads the
  app page before the callback runs. The mock now serves a small login page
  at `/authorize` where the test types an account, and resubmits the request
  with it. The page's form carries the identity, so the cookie is gone.

`beforeTokenSigning` sets `sub`, `email`, `email_verified` and `name`. Setting
`email_verified: true` matters, because Convex Auth links a new OAuth account
to an existing user that has the same verified email (`implementation/users.js`,
`uniqueUserWithVerifiedEmail`). Unique emails keep tests independent. The same
behaviour also lets a separate test cover "Guest signs in to an existing
account".

## Why not the alternatives

- **A real Google test account.** Google blocks sign-in from browsers "being
  controlled through software automation rather than a human"
  ([Google Account Help][google-block]). A test account also needs stored
  secrets, runs into 2-Step Verification and risk checks, and can't run on
  fork PRs. The CI e2e job currently needs no secrets (`docs/development.md`).
- **Playwright `page.route` interception.** It only sees browser traffic. The
  code exchange and discovery (steps 2 and 4) run inside the Convex backend,
  which Playwright can't intercept, and faking the browser-side redirect alone
  would skip the `userOAuth` mutation this test is for.
- **Calling `auth:store` `userOAuth` directly.** That is what
  `convex/tests/auth.test.ts` already does. It can't catch breakage in the
  verifier handoff, the HTTP actions or the middleware.

## Implemented

- `convex/convex.config.ts` declares `E2E_GOOGLE_ISSUER`.
- `convex/auth.ts` applies the `Google({ issuer })` override above.
- `e2e/oidc-mock.mjs` wraps `OAuth2Service` in a Node HTTP server that adds
  the login page, listening on `E2E_GOOGLE_ISSUER`.
- `playwright.config.ts` also starts the mock when `E2E_GOOGLE_ISSUER` is set.
- `scripts/setup-e2e-convex-env.mjs` sets `E2E_GOOGLE_ISSUER`,
  `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` on the backend when the variable is
  set, and CI sets `E2E_GOOGLE_ISSUER=http://localhost:8765`.
- The test lives in `e2e/guestMerge.guest.spec.ts`, next to the password test:
  1. As a Guest, create a room, start a game and guess `house`.
  2. Open `/signin`, click **Continue with Google**, type the worker's e2e
     account on the mock's page and sign in. The page lands on `/`.
  3. Using the new token, poll `users.getUser` and `users.getActivityGraph`
     until the email is the account's and one game has been played.
  4. Open the room and check the guess is still there. Ending the room there
     proves the account is still Host.

Result on the local anonymous backend: it passed with #133's fix (45 of 45
across three `--repeat-each=15` runs with 4 workers) and failed on `main`'s
`auth.ts` and `guestMerge.ts` with `played: 0`, while sign-in itself
succeeded.

Limits:

- The mock must run on the same machine as the Convex backend, which is true
  for the local backend but not for a cloud dev deployment. The spec is
  skipped when `E2E_GOOGLE_ISSUER` is unset.
- The sign-out race above is a real app bug, not just a test artifact. A
  Guest with another tab open, or a Google sign-in that redirects back
  without showing a page, can have a stale Guest tab sign the new account
  out. The test avoids it the way real Google usually does; the app still
  needs a fix.

[oms]: https://github.com/axa-group/oauth2-mock-server
[navikt]: https://github.com/navikt/mock-oauth2-server
[google-block]: https://support.google.com/accounts/answer/7675428
