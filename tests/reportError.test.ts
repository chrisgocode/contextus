import * as Sentry from "@sentry/nextjs";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportClientError } from "../lib/report-error";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

describe("reportClientError", () => {
	beforeEach(() => vi.clearAllMocks());

	it("always reports errors and only suppresses explicitly disabled toasts", () => {
		const error = new Error("failure");

		reportClientError(error, {
			userMessage: "Inline error",
			context: "inline",
			showToast: false,
		});
		expect(Sentry.captureException).toHaveBeenCalledWith(error, {
			tags: { surface: "inline" },
		});
		expect(toast.error).not.toHaveBeenCalled();

		reportClientError(error, { userMessage: "Toast error" });
		expect(toast.error).toHaveBeenCalledWith("Toast error");
	});
});
