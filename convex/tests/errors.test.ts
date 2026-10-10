import { ConvexError } from "convex/values";
import { expect, test } from "vitest";
import { appError, appErrorData } from "../lib/errors";

test("appError carries its code and a readable message", () => {
  const error = appError("hostOnly");
  expect(error).toBeInstanceOf(ConvexError);
  expect(error.data).toEqual({ code: "hostOnly", message: "Host only" });
  expect(appError("usernameLength", "Too short.").data).toEqual({
    code: "usernameLength",
    message: "Too short.",
  });
});

test("appErrorData reads coded errors by shape, on either side of the wire", () => {
  const data = { code: "gameEnded", message: "Game is no longer in progress" };
  expect(appErrorData(appError("gameEnded"))).toEqual(data);
  // What a client holds after the error is serialized.
  expect(appErrorData({ data })).toEqual(data);
});

test.each([
  [
    "a plain-string ConvexError",
    new ConvexError("Game is no longer in progress"),
  ],
  ["an unknown code", new ConvexError({ code: "toString", message: "?" })],
  ["a code without a message", new ConvexError({ code: "gameEnded" })],
  ["an ordinary Error", new Error("offline")],
  ["a non-error", null],
])("appErrorData is null for %s", (_label, error) => {
  expect(appErrorData(error)).toBeNull();
});
