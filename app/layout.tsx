import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { SITE_URL } from "@/lib/site";
import { cn } from "@/lib/utils";
import { NewVersionNotifier } from "./_components/NewVersionNotifier";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Play Contexto with Friends | Contextus",
  description:
    "Play Contexto together in real time. Create a free room, share the code with friends, and solve the same word puzzle as a team. No account needed to start.",
  openGraph: {
    title: "Play Contexto with Friends | Contextus",
    description:
      "Create a free room, share the code, and solve Contexto word puzzles together in real time.",
    siteName: "Contextus",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn("dark font-mono", jetbrainsMono.variable)}>
      <body className="antialiased">
        {children}
        <Toaster richColors position="top-center" />
        <NewVersionNotifier />
      </body>
    </html>
  );
}
