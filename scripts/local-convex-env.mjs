const LOCAL_DEPLOYMENT = /^(local:local-|anonymous:anonymous-)[^:]+$/;

// The environment for a Convex CLI child process that must not use a deploy
// key, which could be production's. Deploy keys outrank CONVEX_DEPLOYMENT, and
// the CLI loads `.env.local` and `.env` itself, so deleting the key from the
// child's environment isn't enough: it's set to "", which the CLI treats as
// unset and dotenv never overrides.
export function withoutDeployKey(env = process.env) {
  return { ...env, CONVEX_DEPLOY_KEY: "", CONVEX_DEPLOYMENT_TOKEN: "" };
}

// Like `withoutDeployKey`, but throws unless the deployment is a local or
// anonymous backend, or self-hosted on 127.0.0.1, and pins the CLI to it.
export function localConvexEnv(env = process.env) {
  const deployment = env.CONVEX_DEPLOYMENT ?? "";
  const selfHostedUrl = env.CONVEX_SELF_HOSTED_URL ?? "";

  if (LOCAL_DEPLOYMENT.test(deployment)) {
    return {
      ...withoutDeployKey(env),
      CONVEX_DEPLOYMENT: deployment,
      CONVEX_SELF_HOSTED_URL: "",
      CONVEX_SELF_HOSTED_ADMIN_KEY: "",
    };
  }
  if (deployment === "" && URL.canParse(selfHostedUrl)) {
    if (new URL(selfHostedUrl).hostname === "127.0.0.1") {
      return { ...withoutDeployKey(env), CONVEX_DEPLOYMENT: "" };
    }
  }
  throw new Error(
    `Refusing to run against a non-local Convex deployment (CONVEX_DEPLOYMENT=${deployment || "unset"}, CONVEX_SELF_HOSTED_URL=${selfHostedUrl || "unset"}). ` +
      "Use `CONVEX_AGENT_MODE=anonymous npx convex dev`, a local deployment, or a self-hosted backend on 127.0.0.1.",
  );
}
