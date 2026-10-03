"use client";

// PROTOTYPE: throwaway variant switcher for UI prototypes. Not for production.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

export function PrototypeSwitcher({
  variants,
}: {
  variants: { key: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("variant") ?? variants[0].key;
  const index = Math.max(
    0,
    variants.findIndex((v) => v.key === current),
  );

  function go(delta: number) {
    const next = variants[(index + delta + variants.length) % variants.length];
    const search = new URLSearchParams(params);
    search.set("variant", next.key);
    router.replace(`${pathname}?${search}`);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (process.env.NODE_ENV === "production") return null;
  const v = variants[index];
  return (
    <div
      data-prototype-switcher
      className="fixed left-1/2 top-2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full bg-yellow-300 px-1 py-1 font-sans text-xs font-semibold text-black shadow-xl"
    >
      <button
        className="rounded-full px-2 py-0.5 hover:bg-black/10"
        onClick={() => go(-1)}
      >
        ←
      </button>
      <span className="px-1">
        {v.key} ({v.name})
      </span>
      <button
        className="rounded-full px-2 py-0.5 hover:bg-black/10"
        onClick={() => go(1)}
      >
        →
      </button>
    </div>
  );
}
