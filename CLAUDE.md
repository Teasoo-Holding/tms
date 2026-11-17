# Working on TMS

TMS (Tree Management System) records and monitors planted trees. It has three parts:

- `backend`: the API, NestJS on PostgreSQL + PostGIS.
- `web`: the portal, React and Vite.
- `android`: the offline field app, Kotlin, Jetpack Compose and Room.

It is live at https://tms.teasooconsulting.com. This repo is public.

## Standing rules

- **Issues first.** Open a GitHub issue for anything you fix or build, and reference it in the PR.
- **Merge your own PRs.** Once CI is green, merge it yourself; don't leave it waiting for review.
- **Work only on issues tagged NOW**, unless the owner says otherwise.
- **Field-disrupting migrations** ship at 6pm WAT (West Africa Time), unless the owner says "merge now".
- **Time zone.** Every date and time shown to users is in WAT.
- **Secrets.** Never commit, log or ask in chat for secrets: API keys, tokens, passwords, keystores. They belong in GitHub Secrets or the Render and Vercel settings.
- **Never point local scripts at production.** The environment may set `DATABASE_URL_UNPOOLED` to the production database. When you migrate, seed or run the API locally, override both `DATABASE_URL` and `DATABASE_URL_UNPOOLED`.

## Keep the portfolio case study up to date

TMS is a case study on the developer's portfolio:

- Page: https://israeloni.vercel.app/work/tms
- Repo: `clepbo/clepbo`
- Entry: `"id": "tms"` in `lib/seed.ts`

**When to update it:** after you ship a feature worth showing. Examples are a new capability, a new map or report, an AI feature, or a big offline or sync improvement. Small fixes don't count.

**How to update it, in the same session:**

1. Attach `clepbo/clepbo` with push access, then read its `HOW-TO-EDIT.md`.
2. Add or update a block in `case.features` ("What it does"): one focused screenshot and one paragraph, saying what the feature does and why it matters. Touch the story, process, decisions and outcome only if the change really affects them.
3. Make sure the change reaches the live site. The live site serves a saved document, so editing `lib/seed.ts` alone changes nothing for a project that is already live. Use `REFRESHED_IN_CODE` in `lib/content.ts` and bump the `tms` number in it.
   - If `REFRESHED_IN_CODE` doesn't exist yet, build it first. It is a map from project id to a version number, and it sits beside `ADDED_IN_CODE`.
   - In `normalise()`, when the saved document's `work.refreshed[id]` is lower than the map's number, replace that project with the seed's copy in the same position, then record the new number.
   - A project the owner deleted must not come back.
   - Document it in `HOW-TO-EDIT.md`.
   - Tell the owner that a refresh replaces any edits they made to TMS in the portfolio's admin.
4. Take screenshots from a local demo with made-up data only. Never use production data, client names or real programme areas. Crop each one to the feature, about 1400 px wide JPEG, saved as `public/assets/media/stills/tmsf-<name>.jpg`.
5. Don't invent numbers or claims, and check facts against the code.
6. Run `npx tsc --noEmit` and `npm run build`, and preview the page at desktop and phone width.
7. Open a PR into `main`, merge it, and check the live page.
8. Never commit `Projects/ESG Horizon.fig`; it's a Git LFS artefact.

If a feature mainly lives on the phone, ask the owner for Android screenshots. They can't be captured here without an emulator.

### Local demo for screenshots

1. Start Postgres: `service postgresql start` (user and password are both `tms`).
2. Create a database called `tms_demo` and add the `postgis` extension to it.
3. In `backend`, set both `DATABASE_URL` and `DATABASE_URL_UNPOOLED` to `postgres://tms:tms@localhost:5432/tms_demo`.
4. With those set, run `npm run migrate`, then `npm run seed`, then `npm run build`.
5. Start the API: `STORAGE_DRIVER=local NODE_ENV=development node dist/main.js`.
6. In `web`, run `npx vite --port 5173`.
7. Log in at `/login` as `admin@tms.local` with the password `ChangeMe!2026`.
8. Add trees, visits and photos through `/api/v1/sync/batches`, logged in as the demo officers.
9. When you're done, stop the servers by port: `fuser -k 3000/tcp 5173/tcp`.
