# AGENTS.md

This file provides guidance to Codex when working with code in this repository. It is kept as a mirror of `CLAUDE.md` — change both together.

## What this is

Feldmark Bank AG — a portfolio/Abschlussprojekt for a Digitalisierungsmanager bootcamp. A fictional bank's system for digitizing the intake of account garnishments (Pfändung) and official information requests (Auskunftsersuchen): OCR + AI classification of uploaded letters, automatic case creation with deadline tracking, and daily n8n sweeps that send reminders/escalations. See `README.md` for the full pitch, architecture diagram, and feature list — don't duplicate it here.

**Only `feldmark_app/` is application code.** Everything else at the repo root is either a schema migration file, an n8n workflow export, or a process-analysis document (see "Repo layout" below).

## Project plan — goals and direction

**Why this project exists, and why it's narrow on purpose.** This is a portfolio/Abschlussprojekt for the Digitalisierungsmanager bootcamp, still pending submission (presentation, tests, live demo required) and also meant to stand as a portfolio piece afterward. The user has real fintech experience specifically with the Pfändung/Auskunftsersuchen process family, so the project deliberately goes deep on exactly these two processes end-to-end (including their reminder variants) rather than building a generic bank intranet (no employee directory, ticketing, etc.) — see KONTEXT.md's "Projektrichtung geklärt" entry. The goal is a practical, understandable, fast, and representative working system: real OCR/classification, real server-side HITL gates, real deadline automation, real legally-complete generated declarations — not a process-analysis exercise. The bootcamp's four core methods (Reifegradmodell, Pareto, Ishikawa, 5-Why) were used during early scoping but are intentionally not part of this repo (see `docs/code_review/` and KONTEXT.md for that history) — they live in the presentation materials, not the codebase. Don't reintroduce methodology docs/framing here without checking with the user first.

**Definition of done**, per `pfaendungs-bauplan.pdf` (a 10-phase build-and-acceptance checklist the user tracks progress against):
- Audit trail complete and self-explanatory for every status change
- HITL/Vier-Augen points documented and implemented as real server-side gates, not just UI copy
- All branches of the Soll-process implemented (full/partial/no Guthaben, Datendiskrepanz, Polizei/StA)
- Escalation logic runs automatically (n8n) and is tested
- Dashboard shows current cases correctly
- A consolidated test matrix, all green
- No secrets in any export or doc
- A short closing report: what got automated vs. what deliberately stays with a human

Note: the Bauplan's own table/column names (`faelle`, `prozessereignisse`, generic status enum, etc.) are a generic course template, not a spec for this repo — this repo's actual schema (`feldmark.pfaendung_faelle`, `..._protokoll`, `..._erweiterung`, etc.) is authoritative. Treat the Bauplan as a milestone/acceptance checklist to track against, never as something to make the schema match literally.

**Closed (2026-08-27):**
- **Consolidated test matrix** — `docs/testmatrix.md`. Pulls together the previously-scattered ad-hoc test evidence from `KONTEXT.md` into one document, organized by feature area, honestly marking what's live-verified vs. only reasoned-about vs. genuinely untested. Update this file when you run new tests — don't start a second matrix.
- **Case-rejection path** — an explicit "Ablehnen" action now exists for both the Drittschuldnererklärung (`POST /api/faelle/:id/erklaerung/ablehnen`) and the Auskunftsersuchen-Antwort (`.../antwort/ablehnen`) flows. Design choice (deliberate, see `KONTEXT.md`): no new terminal status — it reuses the existing `'Geprueft'` reset that regenerating a declaration already did silently, but now as an explicit, protocol-logged action (`erklaerung_abgelehnt`/`antwort_abgelehnt` events). Blocked once the case has already been sent (irreversible past that point). No new DB columns.

**Still open:**
- Self-service read-only status link (the Bauplan's optional stretch goal) not built.
- Real send channel is still a placeholder in both n8n sweeps — recipient/subject/body are fully prepared, but there's no actual send node. See README's "Bewusste Grenzen" for the full list of intentional gaps (no core-banking integration, no auth/multi-user roles, unmeasured confidence thresholds).

**How to prioritize next work**: fix real correctness bugs before adding scope — that's what the code-review-and-remediation pass on 2026-08-27 did (every critical/high/medium finding, each verified live against the real DB/n8n workflow before being called done; see `docs/code_review/` and the matching `KONTEXT.md` entries). The remaining two gaps above (real send channel, self-service link) are bigger scope decisions, not small fixes — don't assume the user wants either built; ask first.

## Commands

```bash
cd feldmark_app
npm install
cp .env.example .env   # fill in DATABASE_URL and MISTRAL_API_KEY — see "Database connection" below
npm run dev             # backend (port 4300) + frontend (port 5291) concurrently
npm run build            # vite build (production bundle) — also useful as a quick syntax/type sanity check
npm test                 # node --test over server/*.test.js (27 tests; 2 skip without a sample HEIC)
```

`npm test` hits the real Supabase DB — it needs a working `DATABASE_URL`, and it is not a pure unit suite. There is no lint script — don't invent `npm run lint`. Syntax-checking a single server file: `node --check server/index.js`.

Frontend dev server is fixed to port 5291 (hardcoded in `vite.config.js`, proxying `/api` and `/uploads` to `http://localhost:4300`); backend port comes from `FELDMARK_KLASSIFIKATION_SERVER_PORT` in `.env` (default 4300). Running a second instance against the same ports will conflict — there's no env-driven override for the frontend port, so testing two copies concurrently means editing `vite.config.js`'s proxy target and passing `--port` manually to a second Vite instance.

## Database connection — read before touching `.env` or `DATABASE_URL`

This project requires the **Session Pooler** connection string (`aws-0-eu-west-2.pooler.supabase.com:5432`, user `postgres.<project-ref>`), not the direct one (`db.<project-ref>.supabase.co:5432`). This matters because n8n's host only has IPv4 and the direct connection requires IPv6 — using the pooler everywhere keeps the app and n8n on the same connection path. Get the correct URI from Supabase → Project Settings → Database → Connection string → **Session pooler**. `.env.example` documents this shape (corrected 2026-09-09; it previously showed the direct string, which cannot work here).

Supabase project: **"shotatsertsvadze's Project"** (`ziwzymarlakoxrgdesvw`), region eu-west-2. All app tables live in a dedicated **`feldmark` schema** (not `public`) — the same Supabase project also hosts unrelated tables from other course projects. Table names inside that schema drop the redundant `feldmark_` prefix (e.g. `feldmark.pfaendung_faelle`, not `feldmark.feldmark_pfaendung_faelle`).

## Repo layout

```
feldmark_app/                       Express + React (Vite) — the only real application code
  server/
    index.js                          REST API (Express routes)
    db.js                             All Postgres access — case creation, queries, protocol/audit writes
    mistral.js                        OCR + classification/extraction (Mistral API) + bestimmeRouting()
    pkonto_drittschuldner.js          Deterministic (non-LLM) Drittschuldnererklärung text generator
    auskunftsersuchen_antwort.js      Deterministic Auskunftsersuchen response text generator
    datendiskrepanz.js                Text templates for the Datendiskrepanz follow-up workflow
    convert.js                        HEIC/HEIF → usable image conversion for uploads
  src/
    App.jsx                           Router shell (react-router-dom) + Sidebar
    app/Sidebar.jsx                   Bank branding + feature navigation (currently one feature)
    features/pfaendung-auskunftsersuchen/   The one existing feature: Posteingang, Fallübersicht, Prozessdiagramm
      dokumenttypen.js                  Central doc-type label/color mapping, shared across components
      fristlogik.js                     Deadline-zone logic shared by the Fristleiste UI and other views
      api.js                            Frontend API client

feldmark_*.sql                      Additive Postgres schema/migration files, one per feature slice, each
                                     independently runnable. When a live migration is applied to Supabase,
                                     the matching .sql file must be updated too — they're known to drift
                                     (e.g. a status CHECK constraint value added live but not committed).

feldmark_fristueberwachung*.json    n8n workflow exports (Pfändung sweep + its earlier "mock"/non-Postgres
                                     variant). These are STATIC SNAPSHOTS, not the source of truth — the
                                     live workflow runs in the n8n instance below and can be edited there
                                     directly without ever touching these files. They are known to go stale
                                     (documented fixes applied live were absent from the checked-in export
                                     for weeks). Don't assume the JSON reflects current live behavior;
                                     verify against the live workflow via the n8n API/UI before relying on
                                     or re-exporting it.

docs/code_review/                   Dated code-review reports with prioritized, checkable action items.
docs/testmatrix.md                  Living, consolidated test matrix (not dated/snapshot like the code
                                     reviews) — update in place when new tests are run, don't fork a
                                     second one.

docs/intern/KONTEXT.md              Running session log for this project — the primary source of "what
                                     was built, why, what's still open, and what was decided and rejected."
                                     Check it for project history/context before assuming something is
                                     unbuilt or making an architectural call that may already have been
                                     made and documented. It's large; grep for a topic rather than reading
                                     it end to end.

docs/intern/RALPH-PROGRESS.md       Log of a multi-pass hardening run (backlog items, findings, fixes).
                                     Both files moved out of the repo root on 2026-09-09 so the root reads
                                     as a project rather than a worklog; ~76 code comments still refer to
                                     them by bare filename ("siehe KONTEXT.md", "RALPH-PROGRESS.md Backlog
                                     #n") — those were deliberately NOT rewritten, since the filenames are
                                     unchanged and still greppable.

muster_dateien/                     Sample test documents, including deliberate plausibility-trap files
                                     used to verify the classifier doesn't blindly trust doc type/OCR text.

belegerkennung/                     Local-only reference copy of an unrelated module. Gitignored — not
                                     part of this project, don't treat it as such.
```

## Cloud resources

- GitHub (public): `github.com/shotatsertsvadze/feldmark-bank-ag`
- Supabase project `ziwzymarlakoxrgdesvw` ("shotatsertsvadze's Project"), schema `feldmark`
- n8n: `https://n8n.skill-sprinters.de`
  - `Ix9jAYFWgh73fPv9` — Pfändung Fristüberwachung sweep (Postgres), daily 07:00
  - `vAHlgWXDJXIS2cps` — Auskunftsersuchen Fristüberwachung sweep (Postgres), daily 07:15
  - `VASVi0WFdgXR2OSb` — shared Fristüberwachung Fehler-Alert workflow (Error Trigger, attached to both sweeps above)
  - Postgres credential in n8n ("Postgres account 6") uses the Session Pooler — see "Database connection" above for why

## Architecture: data flow

Upload → Mistral OCR → one classification+extraction chat call (JSON mode) → `bestimmeRouting()` in `server/mistral.js` (pure function: confidence + plausibility checks, fail-closed — a missing confidence value counts as *no* confidence, never as an automatic pass) → either an automatic case (`legePfaendungsfallAn()` in `db.js`) or the generic cross-type Sichtprüfung queue. Reminder letters (Erinnerungsschreiben) are matched against existing Aktenzeichen instead of creating a new case.

Two daily n8n sweeps (one per case type) independently query Postgres directly — not through the Express API, because `feldmark_app` isn't deployed anywhere (localhost only) and n8n runs in the cloud. They handle reminder/escalation/deadline-miss logic with an idempotency guard (`erinnerungen_gesendet` array marker check before each state transition) and log every action to a protocol/audit table that the frontend's Fall-Verlauf and Aktivitäts-Feed read from.

## Key architectural decisions (with reasons — don't relitigate without checking KONTEXT.md first)

- **Separate tables per case type** (`pfaendung_faelle`, `auskunftsersuchen_faelle`, plus a type-agnostic `sichtpruefung_warteschlange`) rather than one generic table — different deadline logic (ZPO vs. StPO) and the type is genuinely uncertain at the Sichtprüfung stage.
- **`zustelldatum`/`eingangsdatum` never comes from the model** — always from upload metadata, never parsed from document text. This is a load-bearing invariant, not a style preference.
- **Vier-Augen (four-eyes) enforcement lives server-side**, not just in the UI, and low-confidence-amount overrides are logged as protocol events rather than a dedicated column, to avoid touching the original case table's schema.
- Case-table schema changes (e.g. adding a status value to a `CHECK` constraint) are treated as rare, deliberate exceptions to "don't touch the original tables" — but every such exception must be applied to both the live Supabase schema *and* the corresponding `.sql` file in the same change, and audited if any n8n `SELECT *` node depends on that table's shape.
