export function getErrorData(error: unknown): unknown {
	return typeof error === "object" && error !== null && "data" in error
		? error.data
		: undefined;
}
