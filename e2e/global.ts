import type { FullConfig } from "@playwright/test";
import { e2eAccountEmail, REGISTERED_USERS_PER_TEST } from "./accounts";
import { purgeAccount } from "./convex";

async function cleanup(config: FullConfig) {
  const purges = [];
  for (let worker = 0; worker < config.workers; worker += 1) {
    for (let account = 0; account < REGISTERED_USERS_PER_TEST; account += 1) {
      purges.push(purgeAccount(e2eAccountEmail(worker, account)));
    }
  }
  await Promise.all(purges);
}

export default async function globalSetup(config: FullConfig) {
  await cleanup(config);
  return () => cleanup(config);
}
