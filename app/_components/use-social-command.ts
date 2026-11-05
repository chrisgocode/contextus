"use client";

import { useQuery } from "convex/react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { reportClientError, type Reported } from "@/lib/report-error";
import type { ErrorContext } from "@/lib/client-errors";

type CommandAction =
  | "add"
  | "answer"
  | "cancel"
  | "unfriend"
  | "invite"
  | "answerInvite"
  | "presence";

type Command = { kind: "idle" } | { kind: "running"; action: CommandAction };

// One local busy scope. A new viewer/destination or unmount revokes the
// completion's authority to update controls, report errors, or navigate.
export function useSocialCommand(destination?: string) {
  const viewer = useQuery(api.users.getUser, {});
  const scope = useMemo(
    () => ({ viewer: viewer?._id, destination }),
    [viewer?._id, destination],
  );
  const active = useRef<object | null>(null);
  const pending = useRef<object | null>(null);
  const [state, setState] = useState<{ scope: object; command: Command }>({
    scope,
    command: { kind: "idle" },
  });
  const command: Command =
    state.scope === scope ? state.command : { kind: "idle" };

  useLayoutEffect(() => {
    active.current = scope;
    pending.current = null;
    return () => {
      active.current = null;
    };
  }, [scope]);

  const run = useCallback(
    async <T>(
      action: CommandAction,
      fn: () => Promise<T>,
      opts: { context: ErrorContext; fallback: string; showToast?: boolean },
    ): Promise<Reported<T> | undefined> => {
      if (active.current !== scope || pending.current !== null) return;
      const attempt = {};
      pending.current = attempt;
      setState({ scope, command: { kind: "running", action } });
      const current = () =>
        active.current === scope && pending.current === attempt;
      try {
        const value = await fn();
        if (current()) return { ok: true, value };
      } catch (error) {
        if (current())
          return {
            ok: false,
            message: reportClientError(error, {
              context: opts.context,
              userMessage: opts.fallback,
              showToast: opts.showToast,
            }),
          };
      } finally {
        if (current()) {
          pending.current = null;
          setState({ scope, command: { kind: "idle" } });
        }
      }
    },
    [scope],
  );
  return { command, busy: command.kind === "running", run };
}
