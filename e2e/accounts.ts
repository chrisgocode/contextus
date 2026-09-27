// How many registered users one test may create. Global setup purges this
// many accounts per worker, so crashed runs can't leak them.
export const REGISTERED_USERS_PER_TEST = Number(
  process.env.E2E_REGISTERED_USERS_PER_TEST ?? 4,
);
if (
  !Number.isInteger(REGISTERED_USERS_PER_TEST) ||
  REGISTERED_USERS_PER_TEST < 1
) {
  throw new Error("E2E_REGISTERED_USERS_PER_TEST must be a positive integer");
}

export function e2eAccountEmail(workerIndex: number, accountIndex: number) {
  const cleaned = (process.env.E2E_ACCOUNT_NAMESPACE ?? "local")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 32);
  const namespace = cleaned || "local";
  return `contextus-e2e-${namespace}-w${workerIndex}-u${accountIndex}@example.com`;
}
