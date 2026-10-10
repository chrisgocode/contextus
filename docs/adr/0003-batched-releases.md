# Batched releases through a release PR

Every merge to `main` used to deploy Convex and Vercel, which ran into Vercel's build rate limits once merges came in dozens a day. Merges to `main` now only update a release PR kept open by release-please. Merging that PR tags a release and deploys it, so one deploy ships every change merged since the last release.

- **release-please over Changesets:** release-please reads the Conventional Commit subjects we already enforce, so PRs need no extra file. Changesets asks every PR for a hand-written changeset, which suits published packages more than a single app. semantic-release releases on every merge, which is what we are moving away from.
- **One workflow deploys both:** `deploy.yml` runs `convex deploy` and then `vercel deploy --prod` on the release tag. The old setup deployed Convex from Actions and Vercel from its Git integration, with no order between them. Vercel's Git deployments are off in `vercel.json`.
- **Vercel builds remotely:** `vercel deploy` uploads the source and builds on Vercel, not the runner, so `VERCEL_DEPLOYMENT_ID` still becomes the app version.

## Consequences

Merged work waits in `main` until someone merges the release PR, so production can lag `main`. A hotfix ships by merging the release PR too, along with everything merged before it. The release PR is opened with a personal access token, which expires and has to be rotated. Vercel's Git deployments are off for every branch, because a preview skipped by the Ignored Build Step still counts toward the daily deployment limit. This first meant no PR preview deployments; [ADR 0004](0004-label-gated-previews.md) adds them back for labelled PRs, deployed from Actions.
