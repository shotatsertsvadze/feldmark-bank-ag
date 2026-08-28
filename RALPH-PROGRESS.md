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

## Iteration 2 (2026-08-28) — Backlog #2: HITL boundaries

Note: a second `/ralph-loop` invocation happened between iterations 1 and 2
(argument `@RALPH-PROGRESS.md`), again misconfigured the same way as the
first attempt (`max_iterations: 0`, no stop condition, "cannot be stopped
manually"). Cancelled again before it did anything, same as iteration 0's
false start — continuing inline as agreed. If a future iteration sees a
`.claude/ralph-loop.local.md` file, it's very likely another stray
misconfigured attempt — check with the user before assuming it should
actually run unbounded.

**What I did:** Enumerated every process step across Pfändung, Auskunftsersuchen,
Datendiskrepanz, and the n8n sweeps, and classified each as automatic or
requiring human approval, with reasoning — written up in
`docs/HITL-GRENZEN.md`. Cross-checked against `KONTEXT.md`'s existing
Vier-Augen decisions rather than re-deciding from scratch.

**Finding: no new gates were needed.** Unlike Backlog #1, this one came back
clean — every step that should require human approval already does, and
verifiably so:
- Drittschuldnererklärung freigeben and Auskunftsersuchen-Antwort freigeben
  (**the explicit "Datenherausgabe an Polizei/Staatsanwaltschaft" case named
  in the backlog**) both already have a real server-side Vier-Augen gate:
  the route returns 409 and never calls the DB-mutating function unless
  `vier_augen_bestaetigt: true` is explicitly sent.
- Confirmed (by reading the Datendiskrepanz sweep code closely) that the
  auto-generated "fristwahrende Erklärung" (day-10 fallback) only ever
  reaches draft state automatically — the sweep never calls
  `gibErklaerungFrei`/`bestaetigeVersand`. A human still has to freigeben +
  versenden it through the normal two-step flow. This wasn't obvious without
  reading the code and is now written down explicitly in the doc so it
  doesn't need re-discovering.
- Kontosperre-Entscheidung and account-related steps: this project has no
  real core-banking integration, so "Konto sperren/entsperren" from the
  Bauplan's example table doesn't exist here as an automatable action at
  all — the decision itself is already 100% manual (`entschieden_von` is a
  required field). Documented why this means no additional gate is needed,
  rather than silently skipping it.

**Verified with a passing automated test:** `feldmark_app/server/hitl-gates.test.js`,
3 new tests, run via `npm test`. Unlike #1's tests (which called db.js
functions directly), these spin up the **real Express server** as a child
process on its own test port (4399) and hit it over real HTTP — proving the
gate at the layer that actually matters (the route), not just the
underlying data function. Each test asserts both the HTTP status *and* that
the case's DB status genuinely did not change — a gate that blocks the HTTP
response but still runs the mutation underneath would fail this.

```
✔ Vier-Augen-Gate (Drittschuldnererklaerung): ... blockiert (409) ... Status aendert sich NICHT
✔ Vier-Augen-Gate (Auskunftsersuchen-Antwort / Datenherausgabe an Behoerde): ... blockiert (409) ...
✔ Freigabe-Endpunkte lehnen einen Request komplett ohne 'freigegeben_von' ab (400) ...
ℹ tests 7 (4 from #1 + 3 new)
ℹ pass 7
ℹ fail 0
```

Full suite (`npm test`, both test files) still green — 7/7. Confirmed no
leftover `RALPH-TEST-*` rows and the spawned test-server process exits
cleanly (checked `lsof -i :4399` after the run — nothing bound). Also ran
`npm run build` again as a regression check (clean).

**Files touched:** new `docs/HITL-GRENZEN.md`, new
`feldmark_app/server/hitl-gates.test.js`. No production code changed this
iteration — the finding was "already correct," not "broken."

**Decision a future iteration/human should know about:** I did not add a
gate anywhere, because I didn't find a real gap — only documented and
proved what already exists. If a future iteration or a human disagrees that
this is sufficient coverage (e.g. wants a gate on the Datendiskrepanz
reaktivieren step too, even though it already requires two mandatory human-
supplied fields), that's a design opinion worth discussing, not something I
want to silently add code for without being asked.

## Backlog (prioritized, from the original prompt)

- [x] **1. Audit trail completeness** — done, tested, iteration 1.
- [x] **2. HITL boundaries** — done, tested, iteration 2. `docs/HITL-GRENZEN.md` —
  finding was "already correct," no new gates needed; documented + proved it.
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

Not yet reached — 2 of 5 iterations done. Continue with the next
highest-priority unmarked item above (item 3, but re-read its note first —
it may turn out to already be satisfied like item 2 did).
