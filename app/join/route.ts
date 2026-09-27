import { type NextRequest, NextResponse } from "next/server";
import { roomPath } from "@/lib/room-code";

// Target of Home's Join form when it is submitted before hydration. The field
// is `room`, not `code`: the auth middleware takes `?code=` for an OAuth code
// and strips it.
export function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("room") ?? "";
  return NextResponse.redirect(new URL(roomPath(code), request.url), 303);
}
