# Per-workspace encryption of meeting content

**Status:** approved (Oct 3, 2026), phase 1 built · **Owner:** Cristian · **Linear:** COR-40 · **Roadmap:** A1/A6 (ready to sell)

## Problem

Outcome text, action items, quotes and AI context are stored as plain text in MongoDB. Disk encryption (Atlas) protects against stolen disks, not against anyone who gets database access or a copy of a backup: they could read every company's meetings. Security-conscious buyers ask for their data to be unreadable on its own and for a way to cut off access.

## Goal and honest limit

A database copy or backup alone is unreadable, each company's data is encrypted with its own key, and deleting that key makes the company's data permanently unreadable (backups included). Corteza still has to read meeting content to extract and search it, so this is **not** end-to-end encryption: the running app can decrypt.

## Behavior (acceptance criteria)

1. **One key per workspace.** Each workspace has a random 256-bit data key (DEK). Sensitive fields are encrypted with AES-256-GCM using it before they are written.
2. **Keys never sit next to the data.** DEKs are stored only *wrapped* (encrypted) by a key-encryption key (KEK) that is not in the database:
   - Phase 1: `DATA_KEK` environment variable in Railway (separate from `ENCRYPTION_KEY`, so it can be rotated on its own).
   - Phase 2: Google Cloud KMS in our existing Google Cloud project; the app asks KMS to unwrap a DEK and keeps it in memory for a few minutes. KMS access is logged by Google and can be revoked.
3. **Transparent for features.** Pages, APIs, emails, search and the AI see plain text exactly as today. Encryption happens in one place (below), not in each route.
4. **Search keeps working.**
   - Semantic search is unchanged (it uses embeddings).
   - Keyword search can no longer use MongoDB `$regex` or the `$text` index on encrypted fields. It runs in memory over the space's most recent outcomes (cap: 2,000 per search, newest first), after decryption.
5. **Crypto-shredding.** Deleting a workspace destroys its DEK (`destroyed_at`), which makes its outcomes unreadable even in backups.
6. **Mixed data during rollout.** Reads accept both encrypted and plain values, so the app works before, during and after the migration.
7. **Nothing leaks around it.** No plaintext in logs (already a rule); a value that fails to decrypt is logged by document id only and shown as "[unavailable]".

## What gets encrypted

| Collection | Fields |
| --- | --- |
| `decisions` (outcomes) | `text`, `rationale`, `evidence_quote`, `alternatives`, `resolution_note`, `topic`, `source_details.title` |
| `action_items` | `text`, `rationale`, `evidence_quote`, `topic`, `source.title` |
| `ai_context` | company description, glossary, document text; personal role, focus, glossary |
| `ai_suggestions` (upload review queue) | suggestion text, rationale, quote |
| `ai_feedback` (few-shot examples) | example text and dismissal snapshots |
| `ingestions`, `meet_imports` | meeting titles |

Stays readable, with the reason:

- **Ids, dates, types, statuses, space ids:** needed for queries, carry no content.
- **Owner names and tags:** used to filter and match today. Proposed to stay plain in phase 1 and be revisited (open question 2).
- **Embeddings:** vectors, not text. In theory they reveal something about the content; encrypting them would remove semantic search.

## Design

- **Value format:** `enc1:<keyId>:<base64(iv · authTag · ciphertext)>`. The prefix lets reads tell encrypted from plain values; `keyId` allows key rotation. GCM's auth tag detects tampering. The workspace id is bound as associated data, so a value copied into another workspace fails to decrypt.
- **Keys collection** `workspace_keys`: `{ workspace_id, key_id, wrapped_key, kek: 'env:v1' | 'gcpkms:<key name>', created_at, destroyed_at }`. A DEK is created lazily on the workspace's first write.
- **One crypto boundary** `src/core/crypto/`:
  - `keys.js`: create, unwrap and cache DEKs; KEK providers (env, KMS).
  - `fields.js`: the field map above; `seal(workspaceId, collection, doc)` and `open(...)`.
  - `collections.js`: `getDecisionsCollection()` and the `action_items` getter return a thin wrapper. It seals on `insertOne`, `insertMany`, `updateOne` / `updateMany` `$set`, and opens results of `find`, `findOne` and `aggregate`.
  - Routes keep their code. A query filter that targets an encrypted field throws in tests, so a regression is caught in CI, not in production.
- **Call sites to change:**
  - Keyword search in `services/semantic-search.js`, `routes/api.js` and `routes/slack.js`: these become in-memory filters.
  - The `{ text, tags }` text index is dropped.
  - Aggregations that `$group` or `$project` encrypted fields get reviewed one by one (expected few).
- **Performance:** AES-GCM on short strings costs microseconds; DEKs are cached (10 min, per process). There is no extra network call in phase 1, and phase 2 adds about one KMS call per workspace per 10 minutes.

## Rollout

1. Ship the boundary with reads that accept both formats, and writes still plain (`FIELD_ENCRYPTION` off).
2. Set `DATA_KEK` in Railway and turn writes on (`FIELD_ENCRYPTION=on`).
3. Migration `012-encrypt-workspace-data.js`: encrypts existing documents, workspace by workspace. It's a dry run unless `--apply`, resumable, and skips values already encrypted.
4. Verify with the migration's `--check`, which counts plain values left (expect 0), then drop the text index.
5. Phase 2: move KEK to Google Cloud KMS (rewrap DEKs; no data re-encryption).
6. Phase 3 (later, for strict customers): customer-managed key, where their KMS key wraps their DEK and revoking it cuts us off.

## Out of scope

- End-to-end encryption, which is impossible while the server extracts and searches.
- Encrypting embeddings.
- Customer-managed keys (phase 3, its own spec).

## Test plan

- **Unit:**
  - encrypt and decrypt round trip;
  - tampered ciphertext fails;
  - a value from workspace A does not decrypt with workspace B's key;
  - plain values pass through;
  - the env KEK wraps and unwraps.
- **Integration:**
  - the wrapped collection stores ciphertext (raw read) and returns plain text (app read);
  - keyword search finds encrypted outcomes;
  - a filter on an encrypted field throws;
  - deleting a workspace destroys its key and its outcomes read as unavailable;
  - the migration encrypts, is idempotent and `--check` reports 0.
- **Whole suite with encryption on:** CI runs all tests with `FIELD_ENCRYPTION=on`, so every feature is exercised against encrypted data.

## Decisions (Oct 3, 2026)

1. **KEK:** the `DATA_KEK` environment variable in Railway (free) for phase 1; Google Cloud KMS in phase 2 (a few cents a month), when customers ask for it or more people get Railway access.
2. **Owner names and tags:** stay plain in phase 1.
3. **Keyword search:** the newest 2,000 outcomes per space, matched in memory.

## As built (phase 1)

- `src/core/crypto/`: `aead.js` (value format), `keys.js` (DEKs in `workspace_keys`, wrapped by `DATA_KEK`, cached 10 min), `fields.js` (field map, seal/open), `collections.js` (the wrapper). `config/database.js` wraps the Db, so `getDatabase()` and the collection getters are encrypted; `getRawDatabase()` skips the layer (keys, migrations).
- Values are opened wherever they appear in a result (projections, aggregations); writes are sealed in `insertOne`, `insertMany`, `replaceOne`, `updateOne`, `updateMany` and `findOneAndUpdate` (`$set`, `$setOnInsert`, `$push`). An update that doesn't say its workspace reads it from the matched document.
- Keyword search in memory: `services/semantic-search.js` (`keywordSearch`), `routes/api.js` (`GET /api/decisions?search=`), `routes/slack.js` (search command). The `{ text, tags }` text index is dropped.
- GDPR workspace deletion also deletes action items and destroys the workspace's keys.
- CI runs the whole suite twice: plain and with `FIELD_ENCRYPTION=on` + `FIELD_ENCRYPTION_STRICT=true`.
