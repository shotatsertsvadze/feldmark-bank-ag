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

## Iteration 3 (2026-08-28) — Backlog #3: Escalation logic for deadlines

**What I did:** Verified the escalation logic against the backlog's exact
wording by reading the *live* n8n workflows via MCP (not the possibly-stale
checked-in JSON export, per `CLAUDE.md`'s warning) — both
`Ix9jAYFWgh73fPv9` (Pfändung) and `vAHlgWXDJXIS2cps` (Auskunftsersuchen).

**Finding 1 — timing doesn't match the literal backlog spec, deliberately.**
The backlog asks for "reminds at 50% of the deadline, escalates at
75-100%". The real logic uses fixed day-offsets instead: Erinnerung 1 at
Fristbeginn (day 0), Erinnerung 2 three days before Fristende, Eskalation
one day before Fristende. **Asked the user; decision: keep the current
design, document the discrepancy, no code/n8n change for this part.**
Reasoning for keeping it: matches `Fristleiste.jsx`'s UI markers exactly,
already extensively tested (`docs/testmatrix.md` E1-E11), and arguably
better-suited to a 14-day window than a 50%-then-dead-zone-then-75% curve.

**Finding 2 — a real, live bug, found by diffing the two workflows against
each other.** The Auskunftsersuchen sweep's "Fristen berechnen (§ 161
StPO)" Code node was missing the signal-downgrade guard that the Pfändung
sweep's equivalent node already got fixed with on 2026-08-27 (see
`KONTEXT.md`) — despite a comment in the AE node literally claiming "1:1
uebernommen aus der Pfaendungs-Fristueberwachung". Without the guard, a
case that had already received an `eskalation` could still get a
lower-priority `erinnerung_2`/`erinnerung_1` reminder later — the exact bug
that was already found and fixed once, just not ported to its sibling.
**Asked the user; approved. Fixed live**: applied the identical guard
conditions to the AE workflow's Code node via `update_workflow`
(`updateNodeParameters`, verified applied) and published it
(`publish_workflow`) — confirmed by re-reading the live `activeVersion`
node afterward, both draft and active version show the fix. Updated
`docs/testmatrix.md` (new row E12) with this finding.

**Verified with a passing automated test — and also extracted the logic per
the backlog's own testing requirement** ("business logic hiding untested
inside opaque workflow nodes" should be extracted where reasonable): new
`feldmark_app/server/fristlogik.js`, a pure, parameterized re-implementation
of the exact decision algorithm from both Code nodes (n8n itself can't
import this file at runtime — no repo access from the n8n container — so
this is the tested *reference*, not the executing code; the two Code nodes
must still be hand-synced against it, documented prominently in the module
and the n8n node's own comment now). 11 unit tests in
`feldmark_app/server/fristlogik.test.js`, no `DATABASE_URL` needed (pure
function, always runs): erinnerung_1/2, eskalation, fristversaeumnis +
idempotency, erledigt short-circuit, weekend/holiday shift, Postgres
array-string parsing, and — the two tests that matter most here — the
signal-downgrade guard proven correct for **both** the fixed-14-day
(Pfändung) and variable-day (Auskunftsersuchen) parameter sets, so this
exact bug has a regression test now.

```
ℹ tests 18 (11 new fristlogik + 4 audit-trail + 3 HITL)
ℹ pass 18
ℹ fail 0
```

**Files touched:** new `feldmark_app/server/fristlogik.js`,
`server/fristlogik.test.js`; `docs/testmatrix.md` (new row E12); live n8n
workflow `vAHlgWXDJXIS2cps` (Code node fixed + published — not a local file
change, mentioned here so a future iteration doesn't assume `git diff`
shows everything that changed this iteration).

**Decisions a future iteration/human should know about:**
- The 50%/75-100% vs. fixed-offset timing question was explicitly decided
  by the user this iteration (keep current design) — don't re-raise it
  unless they bring it up again.
- `fristlogik.js` is a *reference* implementation, not the live code path.
  If either n8n Code node changes in the future, this file (and its tests)
  need a matching update, and vice versa — there's no automatic sync
  mechanism, this is a known, documented, accepted limitation (n8n can't
  import from this repo).
- Did not run a live `execute_workflow` test of the fixed AE sweep against
  real case data this iteration (all current Auskunftsersuchen cases are
  already in a terminal status per the sweep's own `WHERE status NOT IN
  (...)` filter, so a live run would be a no-op anyway) — the unit tests
  are the actual proof for this iteration; a live end-to-end trigger can be
  requested separately if ever useful (e.g. once new AE cases exist).

## Iteration 4 (2026-08-28) — Backlog #4: Case dashboard

**What I did:** Checked `Falluebersicht.jsx` (the dashboard) against the
backlog's exact wording: "case ID, status, remaining deadline (with a clear
visual severity indicator), last event." Three of four were already there
and solid — `fall_id`, `f.status` as plain text, and the colour-coded
`Fristleiste` bar (moss/ochre/oxblood zones, already covered by
`docs/testmatrix.md`). **"Last event" was genuinely missing** from the
per-case row: it only existed in the separate, cross-case `Aktivitaetsfeed`
panel (requires mentally matching fall_id across a mixed, time-sorted list)
or behind a click-to-expand into `Fallverlauf`. Neither is "the dashboard
shows the last event for this case" at a glance, which is what the backlog
asked for.

**Fix:** `listeOffeneFaelle()` in `server/db.js` now does a
`LEFT JOIN LATERAL` per case type against its protokoll table (ordered by
`erzeugt_am DESC LIMIT 1`, uses the existing `idx_protokoll_fall` index —
no new index needed), returning `letztes_ereignis`/`letztes_ereignis_am`.
`Falluebersicht.jsx` renders it as a small line under the status, reusing
the exact same `verlauf__punkt--*` coloured-dot + `EREIGNIS_LABEL` pattern
`Aktivitaetsfeed.jsx` already uses — so an event looks the same everywhere
in the app, not a new visual language for one more place.

**Verified with a passing automated test:** new
`feldmark_app/server/dashboard.test.js`, 2 tests — creates a real case,
confirms `letztes_ereignis` reflects the fall-creation event, performs
another action (`speichereErklaerung`/`speichereAuskunftsersuchenAntwort`),
re-fetches, and confirms it updated to the new event. Both pass.

```
ℹ tests 20 (2 new dashboard + 18 from iterations 1-3)
ℹ pass 20
ℹ fail 0
```

Also did a live visual check (not just the automated test): created a
throwaway `PF-2026-0534` case, generated a Drittschuldnererklärung so it had
a real event, confirmed in the actual running UI that the row shows
"Drittschuldnererklärung erzeugt · 28.08.2026, 14:13" with the correct
colour, then deleted the throwaway case (protokoll → erweiterung → faelle)
immediately after — confirmed no open cases remained afterward. `npm run
build` clean.

**Files touched:** `feldmark_app/server/db.js` (`listeOffeneFaelle` query),
`src/features/pfaendung-auskunftsersuchen/components/Falluebersicht.jsx`,
`src/index.css`, new `server/dashboard.test.js`.

**Decision a future iteration/human should know about:** scoped this to the
Pfändung/Auskunftsersuchen case list only, not the Sichtprüfung queue — a
Sichtprüfung entry isn't a "case" with a deadline/event history yet (it's
pre-triage), so "last event" doesn't map onto it the same way. If that's
wrong, easy to extend `listeSichtpruefung()` the same way, just didn't seem
in scope for what the backlog meant by "case dashboard."

## Iteration 5 (2026-08-28) — Backlog #5: Ist-Soll docs, BPMN, Ishikawa, 5-Why

**What I did:** Asked the user first (per iteration 0's flagged open
question) how to handle the fact that this project already has all four
methods as static HTML analysis docs at the repo root, while the backlog
asks for `docs/*.md` files cross-referenced to actual code. User confirmed:
port + cross-reference the existing content, don't redo the analysis and
don't skip it. Read the three source HTML docs in full (stripped to text
via a quick script rather than reading raw markup, to keep this efficient):
`Pfaendungsprozess_Analyse_Sollkonzept.html` (Ist-Prozess Abschnitt 2,
Soll-Prozess Abschnitt 3), `Pfaendungsprozess_Methodenanwendung.html`
(Reifegradmodell/Pareto/Ishikawa/5-Why, Abschnitte 1-5),
`Pfaendungsprozess_BPMN_v5_1.html` (four diagrams: A Hauptprozess, B
Datendiskrepanz, C Dauerüberwachung, D Auskunftsersuchen).

Wrote four new docs, each step/branch cross-checked against the actual
current code (not just copied from the source docs) and marked
✅/⚠️/❌ (same legend semantics as `docs/testmatrix.md`):

- `docs/IST-PROZESS.md` — the six-section Ist-Prozess weakness analysis,
  ported, ending in the "kein Fallobjekt" root cause.
- `docs/SOLL-PROZESS.md` — the biggest one. Mermaid swimlane diagram
  (System/Automatisierung, Pfändungsteam, Kunde, Gläubiger lanes via
  subgraphs) of the main flow, plus a second diagram for Ast A
  (Datendiskrepanz). Every Soll-step from Sollkonzept 3.0-3.5 and BPMN
  Diagrams A-D gets an honest status: most of the case-lifecycle logic
  (fall creation, deadline tracking, Datendiskrepanz, Vier-Augen gates,
  audit trail) is ✅; almost everything else that's ❌ traces back to one
  single, from-day-one-deliberate boundary — no core-banking integration
  (README "Bewusste Grenzen") — not to oversights. Said so explicitly
  rather than leaving each ❌ looking like an unrelated small gap.
- `docs/ISHIKAWA-DURCHLAUFZEIT.md` — the four-category fishbone (Mensch,
  Prozess, System, Umfeld/Recht) as a Mermaid diagram, plus a cross-
  reference table mapping each of the eight root causes to what the built
  system does about it.
- `docs/5WHY-DRITTSCHULDNER-KLAERUNG.md` — the five-level Why chain ending
  at "kein Fallobjekt mit Vertretungsfähigkeit", with real code references
  (table/column/function names) for how the built system answers it.

**Real finding while doing this — not something I went looking for, it
surfaced from actually reading both source docs closely:** the project's
own two design documents disagree with each other on one specific point.
The prose Sollkonzept (Abschnitt 3.0, Schritt 4) specifies Erinnerung 1 at
"50 % verbrauchter Frist". The later, more detailed BPMN v5 diagram
(Diagramm A) specifies "Timer: Fristbeginn → Erinnerung 1" — i.e. day 0,
0 %. **The actual code matches BPMN v5 exactly, not the earlier Sollkonzept
prose.** This means my framing in iteration 3 ("the backlog's 50%/75-100%
wording is generic template language, the real design deliberately differs")
was incomplete — it's not just generic wording, one of the project's own
authoritative documents actually specifies 50 % too, and the current
implementation only matches the *other*, later one. Documented this
precisely in `docs/SOLL-PROZESS.md`'s "Hinweis zu Schritt 4" rather than
silently re-opening or silently ignoring the iteration 3 decision — the
user already decided to keep the current behavior, so I didn't touch code
or n8n again, just made sure this fuller picture is on record since it
revises (doesn't reverse) what iteration 3 concluded.

**Verification approach for this iteration (no automated test applies —
these are documentation/diagram files, not executable logic):** every ✅
claim was checked against the actual current code (function names, file
paths, table/column names quoted are real, not paraphrased) rather than
trusted from the source HTML docs, which themselves are sometimes
stale relative to what was later built (e.g. the Methodenanwendung doc
still says the Datendiskrepanz workflow "existiert nicht im Code" — true
when written, false since 2026-08-14, corrected in the new docs). Also
caught and fixed a real Mermaid syntax bug before committing: one diagram
had a German „…" quote whose closing mark was a literal ASCII `"`,
which would have silently broken that node's rendering — found by writing
a small script to check for unbalanced quotes inside every ```mermaid```
block across all four new files, not just eyeballing it.

**Files touched:** new `docs/IST-PROZESS.md`, `docs/SOLL-PROZESS.md`,
`docs/ISHIKAWA-DURCHLAUFZEIT.md`, `docs/5WHY-DRITTSCHULDNER-KLAERUNG.md`.
No application code changed.

**Decisions a future iteration/human should know about:**
- The existing HTML docs at the repo root were **not** deleted or marked
  superseded — they're the original, fuller analysis (e.g. the full 5716px
  BPMN diagrams, the Pareto quantification, the maturity-model table with
  three columns per step) and the new `.md` files are a condensed,
  code-cross-referenced companion, not a replacement. `README.md`'s
  "Methodik" section still points at the HTML docs; wasn't asked to change
  that and didn't.
- The Sollkonzept-vs-BPMN-v5 discrepancy on Schritt 4 timing is now
  written down in exactly one place (`docs/SOLL-PROZESS.md`). If it comes
  up again, that's the reference — no need to re-derive it.

## Backlog (prioritized, from the original prompt)

- [x] **1. Audit trail completeness** — done, tested, iteration 1.
- [x] **2. HITL boundaries** — done, tested, iteration 2. `docs/HITL-GRENZEN.md` —
  finding was "already correct," no new gates needed; documented + proved it.
- [x] **3. Escalation logic for deadlines** — done, tested, iteration 3.
  Timing intentionally kept as fixed day-offsets (not literal 50%/75-100%,
  user decision) — but found and fixed a real live bug in the process: the
  Auskunftsersuchen sweep was missing a signal-downgrade guard its sibling
  Pfändung sweep already had. Not extended to the Datendiskrepanz sweep
  (`/api/sweep/datendiskrepanz`) — that's a structurally different "wait
  N days for a reply" pattern, not a single-deadline reminder/escalation
  curve, so the 50%/75% framing doesn't map onto it the same way; flagged
  but not changed.
- [x] **4. Case dashboard** — done, tested, iteration 4. Most of it already
  existed (KPI tiles, case list, colour-coded Fristleiste, cross-type view)
  but "last event" was genuinely missing from the per-row dashboard view —
  only in the separate global feed or behind a click-to-expand. Added it to
  `listeOffeneFaelle()` + the case row UI.
- [x] **5. Ist-Soll docs, BPMN, Ishikawa, 5-Why** — done, iteration 5. User
  confirmed: port + cross-reference the existing HTML analysis into new
  `docs/*.md` files (not redo the analysis, not skip it). Found a real,
  previously-unnoticed discrepancy between the project's own design docs
  while doing this — see iteration 5 writeup and `docs/SOLL-PROZESS.md`'s
  "Hinweis zu Schritt 4".
- [ ] **6. Self-service read-only status link** — genuinely not built yet
  (confirmed multiple times in `KONTEXT.md`/`CLAUDE.md` as an explicitly
  deferred stretch goal). Correctly last-priority per the backlog ("only
  after 1-5 are solid").

## Needs human input

- **Item 5 framing** — resolved in iteration 5 (port + cross-reference,
  confirmed by user). No longer open.
- **The Sollkonzept-vs-BPMN-v5 Schritt-4 timing discrepancy** found in
  iteration 5 (see that section and `docs/SOLL-PROZESS.md`) — documented,
  not acted on, since iteration 3 already made a decision on the visible
  behavior and this doesn't change that behavior, only the completeness of
  the reasoning behind it. Surface it to the user if it comes up again;
  don't silently revisit.
- General: this backlog reopens scope that was explicitly narrowed on
  2026-08-13 and reaffirmed (with "hold off") on 2026-08-27, then explicitly
  un-held-off in this session on 2026-08-28. The user's own memory/decision
  record (Claude Code's persistent memory) should be updated to reflect
  this reversal now that the backlog run has concluded (see below) — not
  done yet as of this file, should happen in the same session that reads
  this final state.

## Stop condition

**Reached — 5 of 5 iterations complete**, per the run's own stop condition
("after 5 iterations (or earlier if the full backlog above is genuinely
done and tested), stop"). Items 1-5 are done, each with either a passing
automated test (1-4) or, for item 5 (documentation, no executable logic to
test), careful verification against the current real code plus a caught-
and-fixed Mermaid syntax bug before commit.

Item 6 (self-service read-only status link) remains **not done** — by
design, it was explicitly the lowest-priority, "only after 1-5 are solid"
item in the original backlog, and the 5-iteration budget is now spent.
Starting it would be a new decision, not a continuation of this run; if
the user wants it, that's a fresh conversation, not an assumption to make
here.

**Summary for a human reading this in two minutes:** four real, verified
findings came out of this run (silent audit-trail gaps in nine functions,
fixed; HITL gates confirmed already correct; a live signal-downgrade bug in
the Auskunftsersuchen n8n workflow that its sibling had already been fixed
for, found and fixed; "last event" missing from the dashboard, added) plus
one documentation set that makes the existing process analysis
code-traceable for the first time. Every code change has a passing
automated test (`npm test` in `feldmark_app/`, 20/20 green as of iteration
4, unaffected by iteration 5's docs-only changes). Nothing was changed
silently — every judgment call (escalation timing, live n8n edits, docs
framing) was surfaced to the user first.
