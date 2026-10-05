# Morning partner: a daily summary with personality

**Status:** built (Oct 4, 2026) · **Owner:** Cristian · **Linear:** COR-47 · **Roadmap:** B3 (nudges), C4 (follow-through metrics)

## Problem

The daily summary (`src/jobs/daily-digest.js`) is useful, but it reads like every other task reminder ("Your day: 3 overdue…"). People learn to skip it, and a reminder nobody opens does nothing. The market research (Linear: *Referentes de la Industria*) says capture is a commodity and the open problem is getting the work done. A summary people *want* to open, because a partner with a recognizable voice pushes them, is a way to own that.

## Decisions (Oct 4)

- **No swearing**, at any level.
- **Two personalities at launch**, next to today's plain summary:
  - **The Sergeant:** tough love, short and direct. "Three overdue. The pricing page won't build itself. Move."
  - **The Sarcastic Colleague:** dry irony. "The pricing page sends its regards. It's been waiting since Tuesday."
  - **Classic** is today's summary.
- **Default during the beta: The Sarcastic Colleague** (Oct 4). People who haven't picked a partner get Sarcastic, to see the first reaction without notice; Settings lets them switch. `DIGEST_DEFAULT_VOICE` (`classic` | `sergeant` | `sarcastic`) changes the default without a code change; set it to `classic` before opening the beta more widely.
- Our own archetypes, never a real person's name, likeness or catchphrases.

## Behavior (acceptance criteria)

1. **Per person.** Settings → Morning summary gets "Your morning partner" with three options: Classic, The Sergeant and The Sarcastic Colleague. Each option shows a sample line, and picking one saves it immediately. People who never picked get the default (Sarcastic during the beta, see Decisions).
2. **Only in the person's own summary.** The voice is used in that person's daily summary and nowhere else: not in emails colleagues receive, the app UI, capture emails or the weekly digest.
3. **Workspace switch.** An admin can turn personalities off for the workspace (Settings → Morning summary, admins only). Members then get Classic, and the picker says "Turned off by your workspace admin".
4. **What changes in the email:**
   - The **subject** becomes the partner's line for the day, kept under ~70 characters. The counts move to the preheader (the preview text), so the information is still visible in the inbox.
   - The **first line** of the body is the partner's line, followed by one shorter follow-up line.
   - **Everything else stays the same:** the list of due and overdue items with their buttons, the counts, meeting prep and the unsubscribe link. The voice is the hook; the list is the value.
5. **The line fits the day.** The situation comes from the summary the job already builds:

   | Situation | When | Partner's stance |
   |---|---|---|
   | `all_clear` | Nothing overdue and nothing due today (the email went out for other news) | Celebrates, briefly |
   | `due_today` | Something due today, nothing overdue | Focus: pick one and do it |
   | `overdue_few` | 1–2 overdue | Pushes |
   | `overdue_pile` | 3–5 overdue | Pushes harder |
   | `overloaded` | 6 or more overdue | **Eases off:** helps triage ("pick the one that matters, move or drop the rest"). Pushing someone who's drowning reads as shaming |
   | `prep_only` | Only meetings to prepare | Points to the first meeting |

6. **Never push over something the AI may have gotten wrong.**
   - A harsh line never names an item that a colleague's meeting assigned in the last 24 hours (it may be a wrong owner). It uses counts instead.
   - With a partner, every item row gets a small "Not mine?" link that opens the item in Corteza, where owners can be changed. A signed one-click "Not mine" is a follow-up.
7. **Variety.**
   - Lines come from a hand-written library: per personality × situation × language, at least 8 lines per cell at launch.
   - A person doesn't get the same line again within 14 days. The `daily_digests` row stores the line's id, never its text.
   - Lines can use `{count}`, `{weekday}` and, outside the cases in point 6, `{item}`: the first overdue item (the first due today in `due_today`), clipped to 60 characters, quoted and escaped. `{item}` only appears in the follow-up, never in the subject; without an item it may name, the line uses a generic follow-up.
8. **Language.**
   - Each personality has its own voice in **English and Spanish**, written for each language, not translated.
   - The language is the person's Meet "Write outcomes in" setting when it's English or Spanish. Otherwise it's detected from the items in the email (`src/core/language/detect.js`), then the language of their previous summary, falling back to English.
   - Since the app speaks Spanish (docs/specs/2026-10-i18n.md), the whole email uses the person's language, and the partner's line follows it; the guess above only applies when their language isn't known.
9. **No AI at launch.** The library is fixed text, so there's no cost and the tone is under control. Personalizing lines with a model (Haiku, metered with `recordAiUsage`, with guardrails) is a later step, and only if the library wears out.
10. **Measure** (counts and ids only, never text):
    - PostHog `daily_digest_sent` gets `voice` and `situation`.
    - Links in the email carry `?src=digest&voice=<voice>` so clicks can be counted by voice.
    - Completion is counted as action items marked done within 24 hours of a summary, by voice.
    - The question to answer: does a personality raise clicks and completion over Classic?

## Example lines (the full library comes with the implementation)

| Situation | The Sergeant | The Sarcastic Colleague |
|---|---|---|
| `overdue_few` (EN) | "Two overdue. Not tomorrow. Today." | "Two things are overdue. They're not going anywhere. Unlike your deadlines." |
| `overdue_pile` (EN) | "{count} overdue. Excuses don't ship. You do. Move." | "{count} overdue. At this point they're not tasks, they're roommates." |
| `overloaded` (EN) | "{count} overdue is too many to fight at once. Pick one. Win it. Then the next." | "{count} overdue. Even I won't joke about this. Pick the one that matters, move the rest." |
| `due_today` (EN) | "One thing due today. Done by noon. No debate." | "Something's due today. Bold of it to assume you'd remember." |
| `all_clear` (EN) | "Nothing overdue. Good. Don't get comfortable." | "Nothing overdue? Who are you and what have you done with the real you?" |
| `overdue_few` (ES) | "Dos atrasados. No mañana. Hoy." | "Tienes dos cosas atrasadas. Ellas no se van a ningún lado. Tus plazos sí." |
| `overdue_pile` (ES) | "{count} atrasados. Las excusas no entregan nada. Tú sí. Muévete." | "{count} atrasados. A estas alturas no son tareas, son compañeros de piso." |
| `all_clear` (ES) | "Cero atrasados. Bien. No te acomodes." | "¿Nada atrasado? ¿Quién eres y qué hiciste con el de siempre?" |

**Voice rules** (these go in the design skill as "Voice and personality"):
- Push the work, never the person. Speak to effort and the task, never to someone's worth, looks, health or intelligence.
- No swearing, no insults, nothing about bodies, politics, religion or groups of people.
- Short: one line plus one follow-up at most.
- Funny comes from the situation, not from mocking anyone.
- When in doubt, kinder. The `overloaded` situation is always supportive.

## Data

- `workspace_members.digest_voice`: `'classic' | 'sergeant' | 'sarcastic'` (plus `digest_voice_set_at`). Missing means the default (`DIGEST_DEFAULT_VOICE`, else `'sarcastic'`).
- `workspaces.digest_voices_enabled`: missing means `true`. Only admins change it.
- `daily_digests` rows get `voice`, `situation`, `line_id` and `language` (no text).
- No new collection. Neither field is meeting content, so no encryption.

## Code

- `src/core/digest/voice.js` (new):
  - `pickSituation(summary)`
  - `pickLine({ voice, situation, language, recentLineIds, vars })`, returning `{ id, subject, opener, followUp }`
  - the line library, as data, in `src/core/digest/lines/{sergeant,sarcastic}.{en,es}.js`
- `src/jobs/daily-digest.js`: resolve the voice (member setting, workspace switch) and the language, pick the line, pass it to the email, store the ids.
- `src/utils/n8n-client.js`: `dailyDigestSubject` and `dailyDigestHtml` take an optional `partner` (`{ subject, opener, followUp, preheader }`). Classic renders exactly as today.
- `src/core/digest/voice-settings.js` and `src/http/digest-voice.js`: `GET`/`PUT /api/me/digest-voice` (validated against the list) and `PUT /api/workspace/digest-voices` (admins only); the picker in the Morning summary card (`public/scripts/settings-digest-voice.js`).
- `.claude/skills/corteza-design/SKILL.md`: a "Voice and personality" section with the rules above.

## Out of scope (later)

- More personalities (Coach, Zen) once two are validated.
- AI-personalized lines.
- A signed one-click "Not mine" in the email.
- The partner's voice in Google Chat nudges (B3, COR-22) and pre-meeting briefs (COR-25).
- Streaks ("5 days with nothing overdue").

## Test plan

- Unit:
  - `pickSituation` covers each row of the table, including the `overloaded` threshold.
  - `pickLine` never repeats a line within 14 days.
  - `pickLine` doesn't use `{item}` for an item a colleague assigned in the last 24 hours.
  - Every line is escaped, contains no banned words (a word-list test over the whole library), and every cell has at least 8 lines in both languages.
- Email rendering: Classic is byte-identical to today; with a partner, the subject, preheader and opener change and the item list is unchanged.
- Integration: the job uses the member's voice, falls back to Classic when the workspace switch is off, and stores `voice`, `situation` and `line_id` without text. `PUT /api/me/digest-voice` rejects unknown values and a member can't change the workspace switch.
- Preview: `node .claude/skills/corteza-design/scripts/preview-digest.js` renders one email per personality × situation × language and lists every line.
