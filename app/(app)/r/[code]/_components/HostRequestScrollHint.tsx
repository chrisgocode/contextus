export function HostRequestScrollHint({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${count} pending request${count === 1 ? "" : "s"} below. Scroll to requests.`}
      onClick={onClick}
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] right-4 z-50 flex h-10 w-10 items-center justify-center rounded-full border border-primary bg-primary text-xl text-primary-foreground shadow-lg motion-safe:animate-bounce"
    >
      <span aria-hidden="true">↓</span>
      {count > 1 && (
        <span className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full border border-primary bg-background px-1 text-xs font-semibold leading-none text-foreground">
          {count}
        </span>
      )}
    </button>
  );
}
