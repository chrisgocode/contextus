"use client";

import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";

export default function PlayerCountsPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(
      () => setRefresh((value) => value + 1),
      15_000,
    );
    return () => window.clearInterval(timer);
  }, []);
  const overview = useQuery(
    api.playerCounts.overview,
    isAuthenticated ? { refresh } : "skip",
  );

  if (isLoading || (isAuthenticated && overview === undefined)) {
    return (
      <main className="mx-auto max-w-4xl p-6">Loading player counts…</main>
    );
  }
  if (!isAuthenticated || overview === null) {
    return (
      <main className="mx-auto max-w-4xl space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Player counts</h1>
        <p className="text-muted-foreground">This page is private.</p>
        <Link className="underline underline-offset-4" href="/">
          Go home
        </Link>
      </main>
    );
  }
  if (!overview) return null;

  const hour = 60 * 60_000;
  const start = Math.floor(overview.asOf / hour) * hour - 23 * hour;
  const peaks = Array.from({ length: 24 }, () => 0);
  for (const sample of overview.samples) {
    const index = Math.floor((sample.sampledAt - start) / hour);
    if (index >= 0 && index < peaks.length) {
      peaks[index] = Math.max(peaks[index], sample.count);
    }
  }
  const max = Math.max(1, ...peaks);
  const peak = Math.max(overview.count, ...peaks);

  return (
    <main className="mx-auto max-w-4xl space-y-10 px-5 py-8 sm:px-8 sm:py-12">
      <header className="flex items-center justify-between border-b pb-5">
        <div>
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Contextus
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">Player counts</h1>
        </div>
        <span className="rounded-full border px-3 py-1 text-xs font-mono text-muted-foreground">
          PRIVATE
        </span>
      </header>

      <section aria-label="Live player count" className="space-y-3">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <span
            className="size-2 rounded-full bg-emerald-400"
            aria-hidden="true"
          />
          In rooms now
        </p>
        <p className="font-mono text-7xl font-semibold tabular-nums tracking-tight sm:text-8xl">
          {overview.count.toLocaleString()}
          {overview.capped ? "+" : ""}
        </p>
        <p className="text-sm text-muted-foreground">
          Distinct players seen in a room within 45 seconds. Updated{" "}
          {new Date(overview.asOf).toLocaleTimeString()}.
        </p>
      </section>

      <section
        className="rounded-xl border p-5 sm:p-7"
        aria-label="Player count history"
      >
        <div className="mb-8 flex items-baseline justify-between gap-4">
          <div>
            <h2 className="font-semibold">Past 24 hours</h2>
            <p className="text-sm text-muted-foreground">
              Peak connected players each hour
            </p>
          </div>
          <p className="text-right text-sm text-muted-foreground">
            Peak{" "}
            <span className="font-mono text-foreground">
              {peak.toLocaleString()}
            </span>
          </p>
        </div>
        {overview.samples.length === 0 ? (
          <p className="py-14 text-center text-sm text-muted-foreground">
            History appears after the first sample.
          </p>
        ) : (
          <>
            <div
              role="img"
              aria-label={`Hourly peaks over the past 24 hours. Highest: ${peak} players.`}
              className="flex h-44 items-end gap-1"
            >
              {peaks.map((value, index) => (
                <div
                  key={index}
                  className="min-w-0 flex-1 rounded-t-sm bg-primary/70"
                  style={{
                    height: `${Math.max(value > 0 ? 3 : 1, (value / max) * 100)}%`,
                  }}
                  title={`${new Date(start + index * hour).toLocaleString()}: ${value} peak players`}
                />
              ))}
            </div>
            <div className="mt-3 flex justify-between border-t pt-2 text-xs font-mono text-muted-foreground">
              <span>24h ago</span>
              <span>Now</span>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
