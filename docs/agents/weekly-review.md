# Weekly review agent

Runs every Friday at 16:00 (Chile) as a scheduled Claude Code routine. Goal: everything people read
about Corteza stays true after this week's changes. It **proposes** updates in pull requests; Cristian
reviews and merges. Never merge your own PR.

## Steps

1. Repos: `cristiantumani/corteza.app` (the app) and `cristiantumani/Corteza_website` (corteza.app
   website). Add them to the session if they aren't there, and work from the latest `main` of each.
2. List what changed this week: the PRs merged into corteza.app `main` in the last 7 days (titles,
   bodies, specs in `docs/specs/`, and the diff of user-facing files: `src/views`, `public/scripts`,
   `public/i18n`, `src/integrations/google/connections.js`, `src/services/claude.js`, `.env.example`).
   Nothing merged: stop, open no PR, and say so in the final message.
3. Check each surface below against what the product does now. Only change what is out of date.

### In the app (corteza.app)

| Surface | Where | Update when |
|---|---|---|
| How it works / first-run onboarding | `src/views/partials/onboarding.html`, `onboarding.*` keys in `public/i18n/{en,es}.json` | a step names a screen, button or flow that changed, or an important new capability should be one of the steps |
| Empty states and short help texts | `public/i18n/{en,es}.json` | a text describes behaviour that changed |
| Privacy policy and terms | `src/views/legal/{privacy,terms}.{en,es}.html` | a new Google scope, a new provider/subprocessor (AI, email, analytics, hosting), a new kind of data stored, a new place data goes, or a retention change. Update **both languages** and the "Last updated" date |
| Permissions before Google's consent | `src/views/google-connect.html`, `connectGoogle.*` keys | a scope was added, removed or used differently |
| Google verification checklist and demo script | `docs/launch/google-verification.md`, `docs/launch/demo-video-script.md` | scopes, screens or flows they mention changed |

Follow `CLAUDE.md`: every visible text in English and Spanish (glossary in
`.claude/skills/corteza-design/SKILL.md`), sentence case, plain words. Run `npm test` (at least
`test/unit/i18n.test.js` and `test/unit/legal-pages.test.js`), `npm run lint` and `npm run typecheck`
before opening the PR.

### On the website (Corteza_website)

| Surface | Where | Update when |
|---|---|---|
| Product facts for the blog agent | `docs/seo/product-facts.md` | any capability, privacy fact or limitation changed (add, change or remove lines) |
| Landing page copy | `src/components/landing/*` | it describes a feature wrongly or misses one that matters for the pitch (keep edits small; layout changes go to Cristian as a suggestion) |
| `public/llms.txt` | | it describes the product wrongly |
| Old blog posts | `src/data/blog.ts` | a post states something that is no longer true about Corteza (e.g. "integrates with Slack" as the main capture). Fix the sentence; don't rewrite the post |

Check `npx tsc -p tsconfig.app.json --noEmit` and `npm run build` (install with
`npm install --no-package-lock --no-save` if needed; don't commit lockfiles, `dist/` or
`supabase/functions/mcp/index.ts`).

4. Open **one PR per repo** that has changes, on a branch `claude/weekly-review-YYYY-MM-DD`, titled
   `Weekly review: <what changed>`. In the body, list each change with the merged PR that caused it.
   Put legal changes (privacy, terms, permissions) first, under **"Needs your review: legal"**, and say
   why each one is needed.
5. Things you noticed but shouldn't change yourself (a product question, a bigger copy rewrite, a
   possible bug): list them under **"For you to decide"** in the PR, or in the final message if there
   is no PR.

## Never

- Merge, or push to `main`.
- Change code or behaviour: only texts, docs and the product facts.
- Invent capabilities: describe only what is merged into `main`.
- Remove a legal statement without a reason tied to a merged change.
