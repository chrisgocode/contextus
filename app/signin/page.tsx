"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import Image from "next/image";
import { useState } from "react";
import { reportClientError } from "@/lib/report-error";

export default function SignIn() {
	const { signIn } = useAuthActions();
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	return (
		<div className="flex flex-col gap-8 w-full max-w-lg mx-auto h-screen justify-center items-center px-4">
			<div className="text-center flex flex-col items-center gap-4">
				<div className="flex items-center gap-6">
					<Image src="/convex.svg" alt="Convex Logo" width={90} height={90} />
					<div className="w-px h-20 bg-slate-300 dark:bg-slate-600"></div>
					<Image
						src="/nextjs-icon-light-background.svg"
						alt="Next.js Logo"
						width={90}
						height={90}
						className="dark:hidden"
					/>
					<Image
						src="/nextjs-icon-dark-background.svg"
						alt="Next.js Logo"
						width={90}
						height={90}
						className="hidden dark:block"
					/>
				</div>
				<h1 className="text-3xl font-bold text-slate-800 dark:text-slate-200">
					Convex + Next.js + Convex Auth
				</h1>
				<p className="text-slate-600 dark:text-slate-400">
					This demo uses Convex Auth for authentication, so you will need to
					sign in or sign up to access the demo.
				</p>
			</div>
			<form
				className="flex flex-col gap-4 w-full bg-slate-100 dark:bg-slate-800 p-8 rounded-2xl shadow-xl border border-slate-300 dark:border-slate-600"
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
				<button
					className="bg-slate-700 hover:bg-slate-800 dark:bg-slate-600 dark:hover:bg-slate-500 text-white font-semibold rounded-lg py-3 shadow-md hover:shadow-lg transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
					type="submit"
					disabled={loading}
				>
					{loading ? "Loading..." : "Sign up with Google"}
				</button>
				{error && (
					<div className="bg-rose-500/10 border border-rose-500/30 dark:border-rose-500/50 rounded-lg p-4">
						<p className="text-rose-700 dark:text-rose-300 font-medium text-sm wrap-break-word">
							Error: {error}
						</p>
					</div>
				)}
			</form>
		</div>
	);
}
