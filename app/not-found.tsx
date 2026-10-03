import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { NotFoundGuess } from "./_components/NotFoundGuess";

export const metadata: Metadata = { title: "Page not found | Contextus" };

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-4 py-6 sm:p-8">
      <NotFoundGuess lemma="page" />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">Page not found</h1>
        <p className="text-muted-foreground">
          That guess was a long way off. The page you&apos;re looking for
          doesn&apos;t exist or has moved.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button asChild>
          <Link href="/">Back to Contextus</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/how-to-play">How to play</Link>
        </Button>
      </div>
    </main>
  );
}
