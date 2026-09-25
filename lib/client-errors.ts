export function getErrorData(error: unknown): unknown {
  return typeof error === "object" && error !== null && "data" in error
    ? error.data
    : undefined;
}

export function expectedClientErrorMessage(
  error: unknown,
  context: string | undefined,
): string | null {
  const data = getErrorData(error);
  switch (context) {
    case "guess.submit":
    case "host.hint":
    case "host.giveup":
    case "request.hint":
    case "request.giveup":
    case "request.approve.hint":
    case "request.approve.giveup":
      if (data === "Game is no longer in progress")
        return "This game has already ended.";
      break;
  }
  if (context === "host.hint" || context === "request.approve.hint") {
    if (data === "Hint lemma already guessed")
      return "That hint was already guessed.";
    if (data === "Could not find an unguessed hint")
      return "No unguessed hints remain.";
  }
  if (context?.startsWith("request.approve.")) {
    if (data === "Request not found or already handled")
      return "This request was already handled.";
  }
  if (context?.startsWith("request.deny.")) {
    if (data === "Request not found")
      return "This request is no longer available.";
  }
  if (context === "request.hint" && data === "hint request already pending")
    return "Hint request already pending.";
  if (context === "request.giveup" && data === "giveup request already pending")
    return "Give-up request already pending.";
  if (
    (context === "room.join" ||
      context === "room.autojoin" ||
      context === "game.start") &&
    data === "Room not found"
  )
    return "Room not found.";
  if (context === "game.start" && data === "A game is already in progress")
    return "A game is already in progress.";
  if (context === "profile.update" && typeof data === "string") {
    if (
      /^Username must be \d+-\d+ characters\.$/.test(data) ||
      data === "Username can only contain letters and numbers." ||
      data === "Username is already taken."
    )
      return data;
  }
  return null;
}
