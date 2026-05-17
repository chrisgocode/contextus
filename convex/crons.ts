import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("room cleanup", { minutes: 5 }, internal.cleanup.tick, {});

export default crons;
