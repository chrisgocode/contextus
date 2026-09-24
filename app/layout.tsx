import type { Metadata } from "next";
import { Figtree, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import { Toaster } from "@/components/ui/sonner";
import { SITE_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

const figtree = Figtree({ subsets: ["latin"], variable: "--font-sans" });

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
    <ConvexAuthNextjsServerProvider>
      <html
        lang="en"
        className={cn(
          "dark font-sans",
          figtree.variable,
          "font-mono",
          jetbrainsMono.variable,
        )}
      >
        <body className="antialiased">
          <ConvexClientProvider>
            {children}
            <Toaster richColors position="top-center" />
          </ConvexClientProvider>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
