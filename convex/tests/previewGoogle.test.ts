import { beforeEach, expect, test, vi } from "vitest";
// Convex Auth's own sign-in and callback steps, which it doesn't export. They
// are imported by path so the preview overrides are tested against the
// installed library and an upgrade that breaks them fails here.
import { getAuthorizationUrl } from "../../node_modules/@convex-dev/auth/dist/server/oauth/authorizationUrl.js";
import { handleOAuth } from "../../node_modules/@convex-dev/auth/dist/server/oauth/callback.js";
import {
  defaultCookiesOptions,
  oAuthConfigToInternalProvider,
} from "../../node_modules/@convex-dev/auth/dist/server/oauth/convexAuth.js";
// @ts-expect-error Marked internal, so it is missing from the library's types.
import { configDefaults } from "../../node_modules/@convex-dev/auth/dist/server/provider_utils.js";
import { internal } from "../_generated/api";
import Google from "@auth/core/providers/google";
import { callbackSignature, googleProvider } from "../lib/previewGoogle";
import { seedUser, sessionOf, setupTest } from "../testHelpers.test";

const PREVIEW_SITE = "https://happy-animal-123.convex.site";
const FORWARDER =
  "https://prod-animal-456.convex.site/api/preview-oauth/callback/google";
// Shaped like a real signed state, which has a dot in it.
const STATE = "aHR0cHM6Ly9oYXBweS1hbmltYWwtMTIzLmNvbnZleC5zaXRl.c2lnbmF0dXJl";
const ISSUER = "https://accounts.google.com";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const CLIENT_ID = "preview-client-id";

function base64Url(value: object) {
  return btoa(JSON.stringify(value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

// Google, as far as Convex Auth talks to it: discovery and the code exchange.
function stubGoogle() {
  const tokenRequests: URLSearchParams[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === `${ISSUER}/.well-known/openid-configuration`) {
        return Response.json({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/o/oauth2/v2/auth`,
          token_endpoint: TOKEN_ENDPOINT,
          jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
          code_challenge_methods_supported: ["S256"],
        });
      }
      if (url === TOKEN_ENDPOINT) {
        tokenRequests.push(new URLSearchParams(String(init?.body)));
        const now = Math.floor(Date.now() / 1000);
        const idToken = [
          base64Url({ alg: "RS256" }),
          base64Url({
            iss: ISSUER,
            aud: CLIENT_ID,
            sub: "google-account",
            email: "google-account@test.dev",
            iat: now,
            exp: now + 3600,
          }),
          "signature",
        ].join(".");
        return Response.json({
          access_token: "access-token",
          token_type: "Bearer",
          id_token: idToken,
        });
      }
      throw new Error(`Unexpected request to ${url}`);
    }),
  );
  return tokenRequests;
}

// The provider as Convex Auth's HTTP routes build it on every request.
const PREVIEW_ENV = {
  PREVIEW_OAUTH_CALLBACK_URL: FORWARDER,
  PREVIEW_OAUTH_STATE: STATE,
};

async function previewProvider() {
  const [provider] = configDefaults({
    providers: [googleProvider(PREVIEW_ENV)],
  }).providers;
  return {
    provider: await oAuthConfigToInternalProvider(provider),
    cookies: defaultCookiesOptions("google"),
  };
}

beforeEach(() => {
  vi.stubEnv("CONVEX_SITE_URL", PREVIEW_SITE);
  vi.stubEnv("AUTH_GOOGLE_ID", CLIENT_ID);
  vi.stubEnv("AUTH_GOOGLE_SECRET", "preview-client-secret");
});

test("a preview sends Google to production's forwarder with the signed state", async () => {
  stubGoogle();

  const { redirect } = await getAuthorizationUrl(await previewProvider());

  const url = new URL(redirect);
  expect(url.origin + url.pathname).toBe(`${ISSUER}/o/oauth2/v2/auth`);
  expect(url.searchParams.get("redirect_uri")).toBe(FORWARDER);
  expect(url.searchParams.get("state")).toBe(STATE);
  expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
});

test("a Guest signing in with Google on a preview merges into the Google account", async () => {
  vi.stubEnv("PREVIEW_OAUTH_STATE", STATE);
  const tokenRequests = stubGoogle();
  const t = setupTest();
  const guest = await seedUser(t, { isAnonymous: true });
  // `signIn("google")` saves the Guest's session on a verifier row.
  const verifier = await t.run((ctx) =>
    ctx.db.insert("authVerifiers", { sessionId: sessionOf(t, guest) }),
  );

  // The sign-in route, on the preview's own host.
  const signIn = await getAuthorizationUrl(await previewProvider());
  await t.mutation(internal.auth.store, {
    args: {
      type: "verifierSignature",
      verifier,
      signature: signIn.signature,
    },
  });

  // The callback, as production's forwarder passes it on from Google.
  const cookies = Object.fromEntries(
    signIn.cookies.map(({ name, value }) => [name, value]),
  );
  const callback = await handleOAuth(
    { code: "google-code", state: STATE },
    cookies,
    await previewProvider(),
  );
  expect(tokenRequests).toHaveLength(1);
  expect(tokenRequests[0].get("redirect_uri")).toBe(FORWARDER);
  expect(tokenRequests[0].get("code")).toBe("google-code");
  expect(tokenRequests[0].has("code_verifier")).toBe(true);

  await t.mutation(internal.auth.store, {
    args: {
      type: "userOAuth",
      provider: "google",
      providerAccountId: callback.profile.sub,
      profile: { email: callback.profile.email },
      signature: callback.signature,
    },
  });

  const { merges, account } = await t.run(async (ctx) => ({
    merges: await ctx.db.query("guestMerges").collect(),
    account: await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "google").eq("providerAccountId", "google-account"),
      )
      .unique(),
  }));
  expect(account).not.toBeNull();
  expect(merges).toMatchObject([
    { guestUserId: guest, targetUserId: account?.userId },
  ]);
});

test("a deployment with only one preview variable signs in with plain Google", () => {
  expect(googleProvider({})).toBe(Google);
  expect(googleProvider({ PREVIEW_OAUTH_CALLBACK_URL: FORWARDER })).toBe(
    Google,
  );
  expect(googleProvider({ PREVIEW_OAUTH_STATE: STATE })).toBe(Google);
});

test("the E2E issuer wins over the preview variables", () => {
  const e2e = { E2E_GOOGLE_ISSUER: "http://localhost:8765", ...PREVIEW_ENV };

  expect(googleProvider({ E2E_TEST: "1", ...e2e })).toMatchObject({
    options: { issuer: "http://localhost:8765" },
  });
  // The issuer alone does nothing, so a stray one can't redirect sign-ins.
  expect(googleProvider(e2e)).toMatchObject({
    options: { authorization: { params: { redirect_uri: FORWARDER } } },
  });
});

test("a rejected code exchange logs Google's reason", async () => {
  stubGoogle();
  const signIn = await getAuthorizationUrl(await previewProvider());
  const cookies = Object.fromEntries(
    signIn.cookies.map(({ name, value }) => [name, value]),
  );
  // Built before Google starts refusing, since building it runs discovery.
  const provider = await previewProvider();
  const reason = { error: "invalid_client", error_description: "Unauthorized" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(reason, { status: 401 })),
  );
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});

  await expect(
    handleOAuth({ code: "google-code", state: STATE }, cookies, provider),
  ).rejects.toThrow();

  expect(logged).toHaveBeenCalledWith(
    expect.stringContaining(
      '(401, PKCE cookie present): {"error":"invalid_client"',
    ),
  );
});

test("a code exchange without the PKCE cookie says the cookie is missing", async () => {
  stubGoogle();
  const provider = await previewProvider();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ error: "invalid_grant" }, { status: 400 }),
    ),
  );
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});

  await expect(
    handleOAuth({ code: "google-code", state: STATE }, {}, provider),
  ).rejects.toThrow();

  expect(logged).toHaveBeenCalledWith(
    expect.stringContaining("(400, PKCE cookie missing)"),
  );
});

test("the verifier signature is stored unchanged outside a preview", async () => {
  const t = setupTest();
  const verifier = await t.run((ctx) => ctx.db.insert("authVerifiers", {}));

  await t.mutation(internal.auth.store, {
    args: {
      type: "verifierSignature",
      verifier,
      signature: `pkce-verifier ${STATE}`,
    },
  });

  const row = await t.run((ctx) => ctx.db.get("authVerifiers", verifier));
  expect(row?.signature).toBe(`pkce-verifier ${STATE}`);
});

test("only the preview state is dropped from a verifier signature", () => {
  expect(callbackSignature(`pkce-verifier ${STATE}`, STATE)).toBe(
    "pkce-verifier",
  );
  expect(callbackSignature(`pkce-verifier ${STATE} nonce`, STATE)).toBe(
    "pkce-verifier nonce",
  );
  expect(callbackSignature("pkce-verifier other-state", STATE)).toBe(
    "pkce-verifier other-state",
  );
});
