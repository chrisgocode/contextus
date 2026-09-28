"use client";

import { Skeleton } from "@/components/ui/skeleton";

export function RoomSkeleton({ waiting = false }: { waiting?: boolean }) {
  return (
    <main className="mx-auto max-w-6xl p-6 flex flex-col gap-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 sm:items-center sm:gap-4">
        <div className="min-w-0 flex flex-col gap-1">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="flex flex-nowrap items-center justify-end gap-1 sm:gap-2">
          <Skeleton className="h-8 w-8 rounded-none sm:w-28" />
          <Skeleton className="h-8 w-14 rounded-none" />
          <Skeleton className="h-8 w-10 rounded-none sm:w-20" />
          <Skeleton className="h-8 w-8 rounded-none" />
        </div>
      </header>
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="min-w-0">
          <section className="rounded-lg border p-6 flex flex-col items-center gap-4">
            {waiting ? (
              <>
                <Skeleton className="h-7 w-56 max-w-full" />
                <div className="flex w-62 flex-col gap-2 p-3">
                  <div className="flex h-8 items-center justify-between">
                    <Skeleton className="size-8" />
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="size-8" />
                  </div>
                  <div className="grid grid-cols-7">
                    {Array.from({ length: 7 }).map((_, i) => (
                      <div
                        key={i}
                        className="flex size-8 items-center justify-center"
                      >
                        <Skeleton className="h-3 w-4" />
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-y-1">
                    {Array.from({ length: 35 }).map((_, i) => (
                      <div
                        key={i}
                        className="flex size-8 items-center justify-center"
                      >
                        <Skeleton className="size-6 rounded-full" />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex w-full flex-col gap-2">
                  <Skeleton className="h-5 w-60 max-w-full" />
                  <Skeleton className="h-5 w-28 sm:hidden" />
                </div>
                <Skeleton className="h-8 w-24 rounded-none" />
              </>
            ) : (
              <div className="flex w-full flex-col gap-4">
                <Skeleton className="h-7 w-48" />
                <Skeleton className="h-64 w-full" />
              </div>
            )}
          </section>
        </div>
        <aside className="flex flex-col gap-4">
          <section className="border p-4">
            <Skeleton className="mb-3 h-6 w-24" />
            <div className="flex items-center gap-2 px-2 py-1">
              <Skeleton className="size-2 rounded-full" />
              <Skeleton className="size-6 rounded-full" />
              <Skeleton className="h-5 w-32 flex-1" />
              <Skeleton className="h-5 w-10" />
            </div>
          </section>
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
