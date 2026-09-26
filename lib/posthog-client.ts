type PostHog = (typeof import("posthog-js"))["default"];

let ready: (client: PostHog) => void = () => {};
export const posthogReady = new Promise<PostHog>((resolve) => {
  ready = resolve;
});

export function markPosthogReady(client: PostHog) {
  ready(client);
}
