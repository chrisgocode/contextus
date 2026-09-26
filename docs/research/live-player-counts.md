# Live player counts: established patterns

Researched 2026-09-25. **Concurrent players** here means distinct people with a live room session, not daily active users or the number of open tabs.

## What established products expose

- [Steamworks](https://partner.steamgames.com/doc/webapi/ISteamUserStats) exposes a current-player count for an app through `GetNumberOfCurrentPlayers`. Its documentation explicitly excludes players disconnected from Steam. This is a useful model for labeling coverage: a live count reflects observable connected sessions, not everyone who might be playing offline.
- [Roblox Creator Hub](https://create.roblox.com/docs/production/analytics) displays CCU (concurrent users) in a game watchlist. It distinguishes publicly viewable CCU from other analytics that require permissions, including DAU, session time, and revenue. Thus a count's audience is a product choice, not an inherent property of the metric.
- [PlayFab Game Manager](https://learn.microsoft.com/en-us/gaming/playfab/data-analytics/learn-data/trends/trends-quickstart) puts historical DAU/MAU trends in graphs and updates them daily. This is a separate metric from live CCU; a historical CCU chart requires recording CCU samples over time. The sampling conclusion is an inference from the distinction between a current value and historical trend data.
- [Unity Lobby](https://docs.unity.com/lobby/heartbeat-a-lobby) uses host heartbeats to keep a lobby active and marks it inactive after a configured interval (30 seconds by default). This illustrates why presence is inherently approximate around abrupt disconnects.

## Fit for Contextus

- Contextus already uses [`@convex-dev/presence`](https://www.convex.dev/components/presence) for room membership. The component sends heartbeats and changes online status on connection or disconnect, so it is the natural source of live sessions. Its [source](https://github.com/get-convex/presence/blob/main/src/component/public.ts) keeps one presence record per user per room and tracks separate sessions; it expires sessions after missed heartbeats (`2.5 ×` heartbeat interval).
- A sitewide count needs sitewide presence. Summing room counts would miss players outside rooms and double count people in multiple rooms. The component's [`listRoom` query defaults to 104 results](https://github.com/get-convex/presence/blob/main/src/component/public.ts), so `listRoom(...).length` is a bounded small-scale count, not an unlimited exact counter. Convex's [scaling guidance](https://stack.convex.dev/queries-that-scale) recommends keeping frequent heartbeat writes separate from coarse online state to avoid unnecessary reactive query updates.
- For owner-only access, enforce authorization in the Convex query that returns the metric; hiding a route or navigation item alone would still expose a public query. Record periodic snapshots with an [internal Convex cron](https://docs.convex.dev/scheduling/cron-jobs) if the owner needs to inspect counts after being away. The live view and retained history should state their sample time and presence timeout so the numbers are interpretable.

**Implemented first version:** owner-only live count of distinct users in rooms, one user counted across tabs and rooms, with minute-level samples. Room heartbeats populate a separate indexed table because the component's room listing is bounded. The dashboard states the 45-second timeout and displays `1000+` at its current query cap. Players browsing outside a room are outside this metric.
