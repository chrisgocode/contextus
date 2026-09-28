import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("room cleanup", { minutes: 5 }, internal.cleanup.tick, {});
crons.interval(
  "expired guest cleanup",
  { hours: 24 },
  internal.cleanup.removeExpiredGuests,
  {},
);
crons.interval(
  "unknown word cleanup",
  { hours: 24 },
  internal.wordOracle.pruneUnknownWords,
  {},
);

export default crons;
