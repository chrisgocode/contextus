import Link from "next/link";
import type { Metadata } from "next";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function UserProfileLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 p-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Contextus</h1>
        <Button variant="outline" asChild>
          <Link href="/">Home</Link>
        </Button>
      </header>
      {children}
    </main>
  );
}
