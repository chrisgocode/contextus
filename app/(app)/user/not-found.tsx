import { NotFoundGuess } from "@/app/_components/NotFoundGuess";

export default function ProfileNotFound() {
  return (
    <section className="flex flex-col gap-4">
      <NotFoundGuess lemma="player" />
      <h2 className="text-2xl font-semibold">Profile not found</h2>
      <p className="text-muted-foreground">
        No player goes by that username. They may have changed it, or the link
        may be mistyped.
      </p>
    </section>
  );
}
