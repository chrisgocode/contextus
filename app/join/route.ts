import { type NextRequest, NextResponse } from "next/server";
import { roomPath } from "@/lib/room-code";

// Target of Home's Join form when it is submitted before hydration.
export function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code") ?? "";
  return NextResponse.redirect(new URL(roomPath(code), request.url), 303);
}
