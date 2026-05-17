"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function EndGameBanner({
  status,
  answerLemma,
  winnerName,
  winnerImage,
}: {
  status: "won" | "given_up";
  answerLemma: string | null | undefined;
  winnerName: string | null;
  winnerImage: string | null;
}) {
  return (
    <section className="rounded-lg border-2 border-amber-500/60 bg-amber-500/10 p-6 text-center flex flex-col items-center gap-3">
      <h2 className="text-2xl font-bold">
        {status === "won" ? "Won!" : "Game given up"}
      </h2>
      <p className="text-lg">
        The answer was{" "}
        <span className="font-mono font-bold">{answerLemma ?? "?"}</span>
      </p>
      {status === "won" && winnerName && (
        <div className="flex items-center gap-2">
          <Avatar className="h-8 w-8">
            {winnerImage && (
              <AvatarImage src={winnerImage} alt={winnerName} />
            )}
            <AvatarFallback>{winnerName.slice(0, 1)}</AvatarFallback>
          </Avatar>
          <span>{winnerName} got it</span>
        </div>
      )}
    </section>
  );
}
