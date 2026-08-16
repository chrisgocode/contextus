import { expect, test as setup } from "@playwright/test";

setup("registered user", async ({ request }) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) throw new Error("Missing E2E_EMAIL or E2E_PASSWORD");

  const signIn = (flow: "signIn" | "signUp") =>
    request.post("/api/auth", {
      data: {
        action: "auth:signIn",
        args: { provider: "password", params: { flow, email, password } },
      },
    });

  let response = await signIn("signIn");
  if (!response.ok()) response = await signIn("signUp");
  expect(response.ok(), await response.text()).toBeTruthy();

  await request.storageState({ path: "playwright/.auth/user.json" });
});
