// A missing page drawn as a guess ranked 404, styled like the room's guess
// list: 404 sits in the orange band, with the bar sized by the same decay.
export function NotFoundGuess({ lemma }: { lemma: string }) {
  return (
    <div
      aria-hidden="true"
      className="relative overflow-hidden rounded-md bg-neutral-900/60"
    >
      <div
        className="absolute inset-y-0 left-0"
        style={{
          width: `${100 * Math.exp(-403 / 500)}%`,
          background: "rgb(232 144 84)",
        }}
      />
      <div className="relative flex items-center gap-2 px-3 py-2.5 text-white">
        <span className="flex-1 truncate font-semibold">{lemma}</span>
        <span className="min-w-[3ch] text-right font-mono text-sm tabular-nums opacity-90">
          404
        </span>
      </div>
    </div>
  );
}
