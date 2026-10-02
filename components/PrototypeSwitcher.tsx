"use client";

// PROTOTYPE — throwaway. Floating bar for flipping `?variant=` and a mock
// `?req=` state on a page. Never shipped: renders nothing in production.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

export function PrototypeSwitcher({
  variants,
  states,
}: {
  variants: { key: string; name: string }[];
  states?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("variant") ?? variants[0].key;
  const index = Math.max(
    0,
    variants.findIndex((v) => v.key === current),
  );
  const state = params.get("req") ?? states?.[0];

  function set(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.set(key, value);
    router.replace(`${pathname}?${next}`, { scroll: false });
  }

  function cycle(step: number) {
    const n = variants.length;
    set("variant", variants[(index + step + n) % n].key);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowLeft") cycle(-1);
      if (e.key === "ArrowRight") cycle(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (process.env.NODE_ENV === "production") return null;

  return (
    <div className="fixed left-1/2 top-2 z-[100] flex -translate-x-1/2 flex-col items-center gap-1 rounded-full bg-yellow-300 px-3 py-1.5 font-sans text-xs text-black shadow-xl">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => cycle(-1)} aria-label="Previous">
          ←
        </button>
        <span className="font-semibold">
          {variants[index].key} ({variants[index].name})
        </span>
        <button type="button" onClick={() => cycle(1)} aria-label="Next">
          →
        </button>
      </div>
      {states && (
        <select
          value={state}
          onChange={(e) => set("req", e.target.value)}
          className="rounded bg-black/10 px-1"
        >
          {states.map((s) => (
            <option key={s} value={s}>
              req: {s}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
