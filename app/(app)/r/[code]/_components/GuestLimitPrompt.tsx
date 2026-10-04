"use client";

import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";

/**
 * Shown when a Guest is in as many active Rooms as they may be. Creating an
 * account brings them back to `redirectTo`. `children` follow the button.
 */
export function GuestLimitPrompt({
  redirectTo,
  buttonVariant,
  children,
}: {
  redirectTo: string;
  buttonVariant?: ComponentProps<typeof Button>["variant"];
  children?: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <>
      <p>Create an account to host or join more active rooms.</p>
      <Button
        variant={buttonVariant}
        onClick={() =>
          router.push(`/signin?redirectTo=${encodeURIComponent(redirectTo)}`)
        }
      >
        Create account
      </Button>
      {children}
    </>
  );
}
