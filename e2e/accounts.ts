export const REGISTERED_USERS_PER_WORKER = 2;

export function e2eAccountEmail(workerIndex: number, accountIndex: number) {
  const cleaned = (process.env.E2E_ACCOUNT_NAMESPACE ?? "local")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 32);
  const namespace = cleaned || "local";
  return `contextus-e2e-${namespace}-w${workerIndex}-u${accountIndex}@example.com`;
}
