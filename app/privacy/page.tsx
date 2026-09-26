import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy | Contextus",
  alternates: { canonical: "/privacy" },
};

export default function Privacy() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-4 py-6 sm:p-8">
      <Link className="text-sm underline underline-offset-4" href="/">
        ← Back to Contextus
      </Link>
      <h1 className="text-3xl font-bold">Privacy</h1>
      <p>
        We use PostHog to count page visits and understand how people use
        Contextus. Analytics may include an internal user ID, whether you are a
        Guest or signed-in player, and gameplay events such as Games and
        Guesses. We do not send email addresses, display names, or raw typed
        guesses to PostHog.
      </p>
      <p>
        Sentry helps us find errors and measure web performance. Both services
        receive technical data needed to operate, such as your browser and page
        URL. Sentry may also receive your IP address and request details, and it
        records session replays for 10% of visits and for every visit with an
        error. Replays mask all text and block images and media.
      </p>
    </main>
  );
}
