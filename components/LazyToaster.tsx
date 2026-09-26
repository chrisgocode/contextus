"use client";

import dynamic from "next/dynamic";

// Toasts only follow user actions, so the Toaster (and sonner with it) can
// load after hydration instead of in every page's initial bundle.
export const LazyToaster = dynamic(
  () => import("@/components/ui/sonner").then((mod) => mod.Toaster),
  { ssr: false },
);
