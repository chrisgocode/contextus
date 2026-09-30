import { NotFoundGuess } from "@/app/_components/NotFoundGuess";

export default function ProfileNotFound() {
  return (
    <section className="flex flex-col gap-4">
      <NotFoundGuess lemma="player" />
      <h2 className="text-2xl font-semibold">Profile not found</h2>
      <p className="text-muted-foreground">
        There&apos;s no player profile at this address. The username may have
        changed, or the link may be mistyped.
      </p>
    </section>
  );
}
