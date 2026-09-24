// Built once per deployment, so every client polling this sees the version of
// whatever deployment is currently live. Compared against the version baked
// into the client bundle by `lib/new-version.ts`.
export const dynamic = "force-static";

export function GET() {
  return Response.json({ version: process.env.NEXT_PUBLIC_APP_VERSION });
}
