import { expect, test } from "vitest";
import { localConvexEnv, withoutDeployKey } from "./local-convex-env.mjs";

const deployKeys = {
  CONVEX_DEPLOY_KEY: "prod:happy-cat-123|key",
  CONVEX_DEPLOYMENT_TOKEN: "token",
};

test("the Convex CLI child gets blank deploy keys, so it can't reload them from .env.local", () => {
  expect(withoutDeployKey({ ...deployKeys, OTHER: "kept" })).toEqual({
    CONVEX_DEPLOY_KEY: "",
    CONVEX_DEPLOYMENT_TOKEN: "",
    OTHER: "kept",
  });
});

test.each(["local:local-chris-contextus", "anonymous:anonymous-contextus"])(
  "a local deployment (%s) is allowed and pinned",
  (deployment) => {
    expect(
      localConvexEnv({
        ...deployKeys,
        CONVEX_DEPLOYMENT: deployment,
        CONVEX_SELF_HOSTED_URL: "https://convex.example.com",
        CONVEX_SELF_HOSTED_ADMIN_KEY: "admin",
      }),
    ).toEqual({
      CONVEX_DEPLOY_KEY: "",
      CONVEX_DEPLOYMENT_TOKEN: "",
      CONVEX_DEPLOYMENT: deployment,
      CONVEX_SELF_HOSTED_URL: "",
      CONVEX_SELF_HOSTED_ADMIN_KEY: "",
    });
  },
);

test("a self-hosted backend on 127.0.0.1 is allowed", () => {
  expect(
    localConvexEnv({
      ...deployKeys,
      CONVEX_SELF_HOSTED_URL: "http://127.0.0.1:3210",
      CONVEX_SELF_HOSTED_ADMIN_KEY: "admin",
    }),
  ).toEqual({
    CONVEX_DEPLOY_KEY: "",
    CONVEX_DEPLOYMENT_TOKEN: "",
    CONVEX_DEPLOYMENT: "",
    CONVEX_SELF_HOSTED_URL: "http://127.0.0.1:3210",
    CONVEX_SELF_HOSTED_ADMIN_KEY: "admin",
  });
});

test.each([
  { CONVEX_DEPLOYMENT: "prod:happy-cat-123" },
  { CONVEX_DEPLOYMENT: "dev:happy-cat-123", ...deployKeys },
  { CONVEX_DEPLOYMENT: "anonymous:happy-cat-123" },
  { ...deployKeys },
  { CONVEX_SELF_HOSTED_URL: "https://convex.example.com" },
  { CONVEX_SELF_HOSTED_URL: "http://127.0.0.1.example.com:3210" },
  {
    CONVEX_DEPLOYMENT: "dev:happy-cat-123",
    CONVEX_SELF_HOSTED_URL: "http://127.0.0.1:3210",
  },
])("any other deployment is refused: %o", (env) => {
  expect(() => localConvexEnv(env)).toThrow(
    "Refusing to run against a non-local Convex deployment",
  );
});
