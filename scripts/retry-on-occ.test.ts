import { expect, test, vi } from "vitest";
import { retryOnOcc } from "./retry-on-occ.mjs";

const occ = {
  status: 1,
  output:
    "✖ Error fetching POST  http://127.0.0.1:3210/api/update_environment_variables 503 Service Unavailable: OptimisticConcurrencyControlFailure: Data read or written in this mutation changed while it was being run.\n",
};
const ok = {
  status: 0,
  output: "✔ Successfully set 5 environment variables\n",
};

test("an OCC failure followed by success exits 0", () => {
  const run = vi.fn().mockReturnValueOnce(occ).mockReturnValueOnce(ok);
  const sleep = vi.fn();

  expect(retryOnOcc(run, { sleep })).toBe(0);
  expect(run).toHaveBeenCalledTimes(2);
  expect(sleep).toHaveBeenCalledTimes(1);
});

test("any other failure is not retried", () => {
  const run = vi.fn().mockReturnValue({
    status: 1,
    output: "✖ Error fetching POST 401 Unauthorized: BadAdminKey\n",
  });
  const sleep = vi.fn();

  expect(retryOnOcc(run, { sleep })).toBe(1);
  expect(run).toHaveBeenCalledTimes(1);
  expect(sleep).not.toHaveBeenCalled();
});

test("OCC failures give up after the last attempt with its status", () => {
  const run = vi.fn().mockReturnValue(occ);
  const sleep = vi.fn();

  expect(retryOnOcc(run, { attempts: 3, sleep })).toBe(1);
  expect(run).toHaveBeenCalledTimes(3);
  expect(sleep).toHaveBeenCalledTimes(2);
});

test("a child killed by a signal counts as a failure", () => {
  const run = vi.fn().mockReturnValue({ status: null, output: "" });

  expect(retryOnOcc(run, { sleep: vi.fn() })).toBe(1);
  expect(run).toHaveBeenCalledTimes(1);
});
