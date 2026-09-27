import { expect, test } from "vitest";
import { dateForContextoGameId } from "../lib/dates";

test.each([
  [1, "2022-09-19T00:00:00.000Z"],
  [1336, "2026-05-16T00:00:00.000Z"],
])("Contexto game %i is played on %s", (gameId, date) => {
  expect(dateForContextoGameId(gameId).toISOString()).toBe(date);
});
