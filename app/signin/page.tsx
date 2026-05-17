"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/report-error";

export default function SignIn() {
	const { signIn } = useAuthActions();
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	return (
		<main className="flex min-h-screen flex-col items-center justify-center gap-8 px-4">
			<div className="flex w-full max-w-md flex-col items-center gap-3 text-center">
				<h1 className="text-4xl font-bold tracking-tight">Contextus</h1>
				<p className="text-muted-foreground">
					Co-op Contexto with friends. Create a room, share the code, guess
					together.
				</p>
			</div>
			<form
				className="flex w-full max-w-md flex-col gap-4 rounded-2xl border bg-card p-6 shadow-sm"
				onSubmit={async (e) => {
					e.preventDefault();
					setLoading(true);
					setError(null);
					try {
						await signIn("google");
					} catch (err) {
						const message =
							err instanceof Error ? err.message : "Sign-in failed";
						setError(message);
						reportClientError(err, {
							userMessage: "Sign-in failed. Try again.",
							context: "auth.signin",
						});
						setLoading(false);
					}
				}}
			>
				<Button type="submit" disabled={loading} size="lg">
					{loading ? "Signing in…" : "Continue with Google"}
				</Button>
				{error && (
					<p className="rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">
						{error}
					</p>
				)}
			</form>
		</main>
	);
}
