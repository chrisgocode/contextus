export default function HomeLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 p-4 py-6 sm:p-8">
      {children}
    </main>
  );
}
