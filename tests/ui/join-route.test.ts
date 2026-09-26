import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/join/route";

describe("GET /join", () => {
  it("redirects to the normalized room code", () => {
    const response = GET(
      new NextRequest("https://contextus.test/join?code=%20ab12%20"),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://contextus.test/r/AB12",
    );
  });

  it("redirects home without a code", () => {
    const response = GET(new NextRequest("https://contextus.test/join"));

    expect(response.headers.get("location")).toBe("https://contextus.test/");
  });
});
