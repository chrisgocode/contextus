import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How to Play Contexto with Friends | Contextus",
  description:
    "Learn how to play Contexto as a team: create a room, share the code, guess the hidden word, and use each guess's rank to get closer.",
  alternates: { canonical: "/how-to-play" },
  openGraph: {
    title: "How to Play Contexto with Friends | Contextus",
    description:
      "Create a room, share the code, and solve Contexto word puzzles with friends.",
    url: "/how-to-play",
    siteName: "Contextus",
    type: "article",
  },
};

export default function HowToPlay() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 p-4 py-6 sm:p-8">
      <Link className="text-sm underline underline-offset-4" href="/">
        ← Back to Contextus
      </Link>
      <article className="flex flex-col gap-6 leading-relaxed">
        <h1 className="text-3xl font-bold">
          How to play Contexto with friends
        </h1>
        <p>
          Contextus lets a group solve the same Contexto word puzzle together.
          You can start as a guest: one person creates a room and shares its
          six-letter code with everyone else.
        </p>
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Start a game</h2>
          <p>
            The host picks a Contexto puzzle. Friends join with the room code,
            then everyone can submit word guesses. The shared guess list updates
            as your team plays.
          </p>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Use the ranks</h2>
          <p>
            Each guess gets a rank based on how close its meaning is to the
            hidden word. Rank 1 is the answer; smaller numbers mean you are
            getting warmer. Compare your closest guesses and try related ideas
            to narrow down the answer.
          </p>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Solve it together</h2>
          <p>
            Anyone in the room can contribute guesses. If your team gets stuck,
            the host can get a hint; other players can request one. Once you
            solve a puzzle, the host can choose another and keep playing.
          </p>
        </section>
        <p>
          <Link className="underline underline-offset-4" href="/">
            Create a room and play free
          </Link>
          .
        </p>
      </article>
    </main>
  );
}
