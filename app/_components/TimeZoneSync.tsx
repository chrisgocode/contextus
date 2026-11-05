"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect } from "react";
import { api } from "@/convex/_generated/api";
import { reportClientError } from "@/lib/report-error";

// Keeps the signed-in user's time zone current, so local-time achievements
// (streaks, Night Owl, Early Bird) use the player's own calendar day.
export function TimeZoneSync() {
  const { isAuthenticated } = useConvexAuth();
  const currentUser = useQuery(
    api.users.getUser,
    isAuthenticated ? {} : "skip",
  );
  const setTimeZone = useMutation(api.users.setTimeZone);
  const userId = isAuthenticated ? currentUser?._id : undefined;

  useEffect(() => {
    if (userId === undefined) return;
    let current = true;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setTimeZone({ timeZone }).catch((err: unknown) => {
      if (!current) return;
      reportClientError(err, {
        userMessage: "Could not save your time zone.",
        context: "users.setTimeZone",
        showToast: false,
      });
    });
    return () => {
      current = false;
    };
  }, [userId, setTimeZone]);

  return null;
}
