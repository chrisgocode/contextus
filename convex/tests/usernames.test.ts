import { afterEach, expect, test, vi } from "vitest";
import { generateUniqueUsername, randomInt } from "../lib/usernames";
import { seedUser, setupTest } from "../testHelpers.test";

afterEach(() => {
  vi.restoreAllMocks();
});

test("randomInt stays within [0, max)", () => {
  for (const max of [1, 2, 7, 100, 4096]) {
    for (let i = 0; i < 200; i++) {
      const value = randomInt(max);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(max);
    }
  }
});

test("randomInt draws from crypto.getRandomValues, not Math.random", () => {
  const mathRandom = vi.spyOn(Math, "random");
  const getRandomValues = vi.spyOn(crypto, "getRandomValues");

  randomInt(100);

  expect(getRandomValues).toHaveBeenCalled();
  expect(mathRandom).not.toHaveBeenCalled();
});

test("randomInt rejects values in the biased tail", () => {
  const getRandomValues = vi
    .spyOn(crypto, "getRandomValues")
    .mockImplementationOnce((array) => {
      (array as Uint32Array)[0] = 0xffffffff;
      return array;
    })
    .mockImplementationOnce((array) => {
      (array as Uint32Array)[0] = 5;
      return array;
    });

  expect(randomInt(100)).toBe(5);
  expect(getRandomValues).toHaveBeenCalledTimes(2);
});

test("generateUniqueUsername produces well-formed usernames", async () => {
  const t = setupTest();
  const user = await seedUser(t, { email: "gen@test.dev" });

  await t.run(async (ctx) => {
    for (let i = 0; i < 25; i++) {
      const generated = await generateUniqueUsername(ctx, user);
      expect(generated.displayUsername).toMatch(
        /^[A-Z][a-z]+[A-Z][a-z]+\d{2}$/,
      );
      expect(generated.displayUsername.length).toBeLessThanOrEqual(20);
      expect(generated.username).toBe(generated.displayUsername.toLowerCase());
    }
  });
});
