"use client";

import { Skeleton } from "@/components/ui/skeleton";

export function RoomSkeleton() {
  return (
    <main className="mx-auto max-w-6xl p-6 flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-8 w-44" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-20" />
        </div>
      </header>
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
        <aside className="flex flex-col gap-3">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </aside>
      </div>
    </main>
  );
}

export function GuessListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function HomeSkeleton() {
  return (
    <main className="mx-auto max-w-2xl p-8 flex flex-col gap-8">
      <div className="flex justify-between items-center">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-9 w-24" />
      </div>
      <Skeleton className="h-32 w-full rounded-lg" />
      <Skeleton className="h-28 w-full rounded-lg" />
    </main>
  );
}
