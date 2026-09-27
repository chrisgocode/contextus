/**
 * Stands in for Google during e2e runs. With E2E_TEST=1 and E2E_GOOGLE_ISSUER
 * set, `convex/auth.ts` points the Google provider here, so the Convex backend
 * runs the real OAuth flow (discovery, PKCE, nonce, code exchange) against it.
 *
 * Like Google, `/authorize` shows a page before redirecting back, and the test
 * types which account signs in. The page matters: the app page that started
 * sign-in unloads once it loads, as it does with Google.
 */

import { createServer } from "node:http";
import { OAuth2Issuer, OAuth2Service } from "oauth2-mock-server";

const issuerUrl = new URL(process.env.E2E_GOOGLE_ISSUER ?? "");
const issuer = new OAuth2Issuer();
issuer.url = issuerUrl.origin;
await issuer.keys.generate("RS256");
const service = new OAuth2Service(issuer);

// The token request comes from the Convex backend, not the browser, so the
// account is carried from the authorize request by its code.
const accounts = new Map();
service.on("beforeAuthorizeRedirect", (redirect, req) => {
  const account = new URL(req.url, issuerUrl).searchParams.get("account");
  const code = redirect.url.searchParams.get("code");
  if (account !== null && code !== null) accounts.set(code, account);
});
service.on("beforeTokenSigning", (token, req) => {
  // Runs for both the access token and the ID token, so the entry stays.
  const account = accounts.get(req.body?.code);
  if (account === undefined) throw new Error("Unknown authorization code");
  Object.assign(token.payload, {
    sub: `e2e-${account}`,
    // Verified, so Convex Auth links it to an existing user with this email.
    email: `${account}@example.com`,
    email_verified: true,
    name: `E2E ${account}`,
  });
});

// Resubmits the authorize request with the account the test typed.
function loginPage(url) {
  const hidden = [...url.searchParams]
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escape(name)}" value="${escape(value)}">`,
    )
    .join("");
  return `<!doctype html><title>Mock Google</title>
<form action="/authorize">${hidden}
<label>Account <input name="account" required></label>
<button>Sign in</button></form>`;
}

function escape(value) {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", issuerUrl);
  if (url.pathname === "/authorize" && !url.searchParams.has("account")) {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(loginPage(url));
    return;
  }
  service.requestHandler(req, res);
}).listen(Number(issuerUrl.port), issuerUrl.hostname, () => {
  console.log(`Mock OIDC issuer at ${issuerUrl.origin}`);
});
