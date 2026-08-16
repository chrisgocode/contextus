import { describe, expect, it } from "vitest";
import { getErrorData } from "../lib/client-errors";

describe("getErrorData", () => {
	it("reads structured error data without exposing the raw error message", () => {
		expect(
			getErrorData({
				data: "Guest room limit reached",
				message: "[CONVEX M(rooms:create)] Server Error stack trace",
			}),
		).toBe("Guest room limit reached");
		expect(getErrorData(new Error("private details"))).toBeUndefined();
	});
});
