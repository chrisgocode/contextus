import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import { TimeZoneSync } from "@/app/_components/TimeZoneSync";

// Routes that use Convex or auth live under this group. The server provider
// reads the auth cookies, which makes every route below it dynamic, and it
// also hands the session to the client (the auth cookies are httpOnly, so the
// browser can't read them itself). Content-only pages such as /how-to-play
// sit outside the group so they can prerender as static HTML.
export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ConvexAuthNextjsServerProvider>
      <ConvexClientProvider>
        {children}
        <TimeZoneSync />
      </ConvexClientProvider>
    </ConvexAuthNextjsServerProvider>
  );
}
