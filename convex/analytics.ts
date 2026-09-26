import type { Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { env } from "./_generated/server";
import { posthog } from "./posthog";

type EventCatalog = {
  room_created: { room_id: Id<"rooms"> };
  room_joined: { room_id: Id<"rooms">; member_count: number };
  room_left: {
    room_id: Id<"rooms">;
    host_moved: boolean;
    room_ended: boolean;
  };
  room_ended: { room_id: Id<"rooms">; member_count: number };
  game_started: {
    game_id: Id<"games">;
    room_id: Id<"rooms">;
    contexto_game_id: number;
    play_again: boolean;
  };
  request_created: {
    request_id: Id<"pendingRequests">;
    game_id: Id<"games">;
    request_type: "hint" | "giveup";
  };
  request_denied: {
    request_id: Id<"pendingRequests">;
    game_id: Id<"games">;
    request_type: "hint" | "giveup";
  };
  guest_merged: {
    guest_user_id: Id<"users">;
    account_user_id: Id<"users">;
  };
};

export type AnalyticsEvent = {
  [Name in keyof EventCatalog]: {
    name: Name;
    properties: EventCatalog[Name];
  };
}[keyof EventCatalog];

function enabled() {
  return (
    env.POSTHOG_PROJECT_TOKEN &&
    env.POSTHOG_PROJECT_TOKEN !== "disabled" &&
    env.E2E_TEST !== "1" &&
    (env.POSTHOG_ENVIRONMENT === "production" ||
      env.POSTHOG_ENVIRONMENT === "preview")
  );
}

export async function track(
  ctx: Pick<ActionCtx | MutationCtx, "scheduler">,
  distinctId: Id<"users">,
  event: AnalyticsEvent,
) {
  if (!enabled()) return;
  try {
    await posthog.capture(ctx, {
      distinctId,
      event: event.name,
      properties: {
        ...event.properties,
        deployment_environment: env.POSTHOG_ENVIRONMENT,
      },
    });
  } catch (error) {
    console.warn("PostHog analytics could not be scheduled", error);
  }
}

// The browser identifies Guests by their Convex ID, and PostHog refuses to
// alias an already-identified person. Only call this once the Guest's rows
// have merged, since $merge_dangerously can't be undone.
export async function mergeGuestIdentity(
  ctx: Pick<ActionCtx | MutationCtx, "scheduler">,
  guestUserId: Id<"users">,
  accountUserId: Id<"users">,
) {
  if (!enabled()) return;
  try {
    await posthog.capture(ctx, {
      distinctId: accountUserId,
      event: "$merge_dangerously",
      properties: { alias: guestUserId },
    });
  } catch (error) {
    console.warn("PostHog identity merge could not be scheduled", error);
  }
}
