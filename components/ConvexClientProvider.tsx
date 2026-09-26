"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient } from "convex/react";
import { ReactNode } from "react";
import { PostHogIdentity } from "@/components/PostHogIdentity";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export default function ConvexClientProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ConvexAuthNextjsProvider client={convex}>
      {process.env.NEXT_PUBLIC_POSTHOG_ENVIRONMENT &&
        process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN && <PostHogIdentity />}
      {children}
    </ConvexAuthNextjsProvider>
  );
}
