# RALPH-PROGRESS.md

Progress log for the "make Feldmark Bank AG more comprehensive/real-world-ready"
backlog, run **inline in chat, one item at a time** — not via the autonomous
`/ralph-loop` mechanism (that was tried once, misconfigured — unbounded
iterations, no stop condition — and was cancelled before it did anything; see
git history / conversation log if curious, no code came from that attempt).

Read this file first at the start of every iteration. One backlog item per
iteration, implemented completely with a passing automated test before
moving on, committed together with this file.

## Context for whoever reads this next

This is a Digitalisierungsmanager bootcamp capstone (Feldmark Bank AG),
already fairly mature before this backlog started: OCR+classification
intake, full audit-trail-driven case processing for Pfändung (§ 840 ZPO) and
Auskunftsersuchen (§ 161/161a StPO), server-side Vier-Augen gates, n8n daily
deadline sweeps, a rejection path, a consolidated test matrix
(`docs/testmatrix.md`), and process-analysis docs (Ist/Soll, BPMN v5,
Reifegradmodell/Pareto/Ishikawa/5-Why) already exist as static HTML —
**check those before assuming docs items 5.x below need to be built from
zero.** See `CLAUDE.md` and `KONTEXT.md` for the full history.

There is no test DB / mocking layer in this project — "testing" here means
real integration tests against the actual Supabase dev database
(`feldmark` schema), using throwaway `RALPH-TEST-*` rows that get deleted in
an `after()` cleanup hook. That's the established pattern going forward;
keep using it, don't introduce a separate mocked test story.

## Iteration 1 (2026-08-28) — Backlog #1: Audit trail completeness

**What I did:** Verified backlog item 1 ("every case status change writes a
prozessereignisse-style event... if this already exists, verify it is
actually complete") by reading every status-changing code path in
`feldmark_app/server/db.js` and `server/index.js`. It was **not** complete —
found and fixed a real gap:

Nine functions changed `pfaendung_faelle.status` / `auskunftsersuchen_faelle.status`
(or a Datendiskrepanz-specific status field) **without writing any row to
`pfaendung_protokoll`/`auskunftsersuchen_protokoll`** — meaning these
transitions were completely invisible in the Fall-Verlauf/Aktivitätsfeed UI
and in any future audit review:

- `speichereErklaerung` / `speichereAuskunftsersuchenAntwort` (Erklärung/Antwort
  erzeugt — also silently reset status to "Geprueft" on regeneration, unlogged)
- `gibErklaerungFrei` / `gibAntwortFrei` (only logged an event on the Vier-Augen
  *override* path — the normal, non-override freigabe was silent)
- `bestaetigeVersand` / `bestaetigeAntwortVersand` (the irreversible final step
  of the whole Ast-B/E letter flow — completely silent)
- `markiereFristwahrendErklaert`, `reaktiviereDatendiskrepanzFall`,
  `schliesseDatendiskrepanzUngeklaert` (all three Datendiskrepanz/Ast-A
  terminal transitions — silent)
- `protokolliereNachfassung` — **misleadingly named**: despite the name, it
  never called the actual `protokolliere()` audit helper, only updated the
  `pfaendung_datendiskrepanz` table's own columns. The A2 nachfassung branch
  was invisible in the audit trail.

**Fix:** added `protokolliere()` calls *inside* each of these nine db.js
functions (not just at the calling route) so the guarantee lives at the data
layer and can't be skipped by a future route forgetting to log — this
directly matches the backlog's "no status-changing code path skips it"
requirement. Eight of the nine now take (or already had) an
`eingangsdatumIso` parameter, threaded through from whichever caller already
had it in hand (`fall.zustelldatum`/`fall.eingangsdatum` in most routes,
`f.zustelldatum` in the datendiskrepanz sweep loop); `reaktiviereDatendiskrepanzFall`
does one small extra `SELECT` internally instead (mirrors the existing
`entscheideSperre()` precedent), since its route doesn't otherwise fetch a
full fall object.

New event names added, with matching German UI labels in
`dokumenttypen.js` → `EREIGNIS_LABEL` (verified the exact strings match,
no typos — was the one thing that would've silently degraded to raw
snake-case text in the UI otherwise):
`erklaerung_erzeugt`, `erklaerung_freigegeben`, `erklaerung_versendet`,
`antwort_erzeugt`, `antwort_freigegeben`, `antwort_versendet`,
`datendiskrepanz_fristwahrend_erklaert`, `datendiskrepanz_geschlossen_ungeklaert`,
`datendiskrepanz_reaktiviert`, `datendiskrepanz_nachfassung_1_gesendet`,
`datendiskrepanz_nachfassung_2_gesendet`.

No schema/migration change needed — `ereignis` is a free-text column, no
CHECK constraint on the value.

**Verified with a passing automated test:** `feldmark_app/server/db.audit-trail.test.js`,
run via `npm test` (new script, uses Node's built-in `node --test` — zero new
dependencies, Node v23 has it natively). Four integration tests, all
green, run against the real Supabase DB:
1. Pfändung erzeugen→freigeben→versenden writes all three new events.
2. Auskunftsersuchen erzeugen→freigeben→versenden writes all three new events.
3. Datendiskrepanz nachfassung×2 → fristwahrend → reaktiviert writes all four.
4. Datendiskrepanz schliessen-ungeklaert (separate case — mutually exclusive
   with reaktiviert) writes its event.

```
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

Test creates its own `RALPH-TEST-*`-prefixed cases and deletes them (protokoll
→ erweiterung/datendiskrepanz → faelle, FK order) in an `after()` hook —
confirmed no leftover rows post-run via a manual query. Test skips
gracefully (doesn't fail) if `DATABASE_URL` isn't set, e.g. a fresh clone
without `.env`.

Also ran `npm run build` (clean) and `node --check` on both touched server
files (clean) as a regression check — did not re-verify the fix via the
live browser UI this iteration (the automated test is the actual proof the
backlog asks for; a UI screenshot would've been redundant, not additional
evidence).

**Files touched:** `feldmark_app/server/db.js`, `server/index.js`,
`src/features/pfaendung-auskunftsersuchen/dokumenttypen.js`, `package.json`
(new `test` script), new `server/db.audit-trail.test.js`.

**Decision a future iteration/human should know about:** I did *not* touch
`lehneErklaerungAb`/`lehneAntwortAb` (the B11/D6 rejection path) — those
already correctly log via a separate `protokolliereErklaerungAbgelehnt()`/
`protokolliereAntwortAbgelehnt()` call at the route level. I left that
pattern as-is rather than refactoring it to match the new inline pattern,
since it already works and is already tested (`docs/testmatrix.md` B11–B13,
D6) — didn't want to touch working, tested code just for architectural
consistency when the backlog only asked to close actual gaps.

## Backlog (prioritized, from the original prompt)

- [x] **1. Audit trail completeness** — done, tested, this iteration.
- [ ] **2. HITL-Grenzen table** — `docs/HITL-GRENZEN.md` + verify every
  required-approval step has a real server-side gate (not just a comment).
  Note: Vier-Augen gates already exist and are server-side (freigeben routes)
  — this item is mostly about writing the table down and double-checking
  coverage (e.g. does the Datendiskrepanz reaktivieren step need a gate? does
  the Kontosperre-Entscheidung?), not building new gates from scratch. Check
  `KONTEXT.md` for what's already been decided about HITL boundaries before
  assuming a gap.
- [ ] **3. Escalation logic for deadlines** — **already exists and is
  tested** (n8n sweeps, 07:00/07:15 daily, `docs/testmatrix.md` section E,
  50%/75-100% reminder/escalation logic, protocol-logged). This item is
  probably just "verify it's actually complete" like #1 was — check whether
  the *Datendiskrepanz* sweep (`/api/sweep/datendiskrepanz`, still not wired
  into n8n per `CLAUDE.md`) needs the same 50/75% reminder-tier treatment the
  main sweeps have, since right now it's a flat day-count threshold model
  (nachfassung at fixed days, not percentage-of-remaining-deadline). Worth
  double-checking against the backlog's exact wording before assuming done.
- [ ] **4. Case dashboard** — **already exists**
  (`Falluebersicht.jsx`: KPI tiles, case list, colour-coded deadline bar/
  "Fristleiste", last event via Aktivitätsfeed). Check carefully whether
  this item means something specifically missing (e.g. a *combined*
  cross-type view — it already shows both Pfändung and Auskunftsersuchen
  together) before building anything new here.
- [ ] **5. Ist-Soll docs, BPMN, Ishikawa, 5-Why** — **Ist/Soll analysis,
  BPMN v5, Reifegradmodell/Pareto/Ishikawa/5-Why already exist** as static
  HTML docs at the repo root (`Pfaendungsprozess_Analyse_Sollkonzept.html`,
  `Pfaendungsprozess_BPMN_v5_1.html`, etc. — see `README.md`'s "Methodik"
  section and `KONTEXT.md`). The backlog asks for these as `docs/*.md` files
  instead, cross-referenced to what's actually implemented (not
  aspirational) — that's a different, more code-grounded framing than the
  existing HTML docs, so this is likely still real work, just needs to
  **reuse/port the existing analysis content, not redo the analysis from
  scratch**. Needs human input on whether the existing HTML docs already
  satisfy this, or whether the new `.md` + cross-referenced-to-code framing
  is specifically wanted in addition. **Flagging, not deciding.**
- [ ] **6. Self-service read-only status link** — genuinely not built yet
  (confirmed multiple times in `KONTEXT.md`/`CLAUDE.md` as an explicitly
  deferred stretch goal). Correctly last-priority per the backlog ("only
  after 1-5 are solid").

## Needs human input

- **Item 5 framing** (see above) — existing HTML process docs vs. new
  code-cross-referenced `.md` docs the backlog describes. Don't want to
  duplicate a full Ist/Soll+BPMN+Ishikawa+5-Why analysis that already exists
  in a different format without checking first.
- **Items 3 and 4 may already be "done"** per the letter of the backlog —
  next iteration should explicitly re-read the backlog wording against what
  exists and decide whether to mark them done-with-existing-evidence or
  whether there's a specific gap intended. Didn't want to guess and either
  under- or over-build.
- General: this backlog reopens scope that was explicitly narrowed on
  2026-08-13 and reaffirmed (with "hold off") on 2026-08-27, then explicitly
  un-held-off in this session on 2026-08-28. Worth the user knowing that
  their own memory/decision record (Claude Code's persistent memory) may
  read as contradictory across sessions until it's updated to reflect this
  reversal — that update should happen once this backlog run actually
  concludes (5 iterations or backlog-complete), not mid-run.

## Stop condition

Not yet reached — 1 of 5 iterations done. Continue with the next
highest-priority unmarked item above.
