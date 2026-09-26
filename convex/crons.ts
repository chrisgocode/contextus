import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("room cleanup", { minutes: 5 }, internal.cleanup.tick, {});
crons.interval(
  "sample player count",
  { minutes: 1 },
  internal.playerCounts.sample,
  {},
);
crons.interval(
  "expired guest cleanup",
  { hours: 24 },
  internal.cleanup.removeExpiredGuests,
  {},
);

export default crons;
