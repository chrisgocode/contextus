import type { FullConfig } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { e2eAccountEmail, REGISTERED_USERS_PER_WORKER } from "./accounts";

async function cleanup(config: FullConfig) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) throw new Error("Missing NEXT_PUBLIC_CONVEX_URL");
  const client = new ConvexHttpClient(convexUrl);
  for (let worker = 0; worker < config.workers; worker += 1) {
    for (let account = 0; account < REGISTERED_USERS_PER_WORKER; account += 1) {
      await client.mutation(api.e2eCleanup.purgeAccount, {
        email: e2eAccountEmail(worker, account),
      });
    }
  }
}

export default async function globalSetup(config: FullConfig) {
  await cleanup(config);
  return () => cleanup(config);
}
