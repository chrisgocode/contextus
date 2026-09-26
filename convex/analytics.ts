import type { Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { env } from "./_generated/server";
import { posthog } from "./posthog";

export type AnalyticsEvent = {
  name: "room_created";
  properties: { room_id: Id<"rooms"> };
};

export async function track(
  ctx: Pick<ActionCtx | MutationCtx, "scheduler">,
  distinctId: Id<"users">,
  event: AnalyticsEvent,
) {
  if (
    !env.POSTHOG_PROJECT_TOKEN ||
    env.POSTHOG_PROJECT_TOKEN === "disabled" ||
    env.E2E_TEST === "1" ||
    (env.POSTHOG_ENVIRONMENT !== "production" &&
      env.POSTHOG_ENVIRONMENT !== "preview")
  ) {
    return;
  }
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
