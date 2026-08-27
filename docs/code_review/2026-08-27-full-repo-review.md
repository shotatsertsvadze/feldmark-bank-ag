# Code Review — Feldmark Bank AG Repo (Full Repo, High Effort)

**Date:** 2026-08-27
**Scope:** entire repo — `feldmark_app/` (server + frontend), root SQL schema files, root n8n workflow JSON exports, docs. (`belegerkennung/` reference copy excluded — not tracked in git.)
**Method:** 8 finder angles (3 correctness, 3 cleanup, 1 altitude, 1 conventions) via parallel agents + own direct reading, 1-vote recall-biased verification. Findings ranked by severity; correctness bugs first.

---

## Summary

The repo is in good shape overall — the backend has clearly already been through at least one self-review pass (see `KONTEXT.md`, commit `bf0cd83`), and most of the "vier Augen" / status-transition logic is careful and well-commented. This pass found **10 issues worth fixing**, of which the two most important are:

1. A **live, currently-active bug** in `server/db.js` that silently mislabels every Einziehungs-/Überweisungsverfügung case as "Pfändungsschreiben" everywhere it's displayed (case list, activity feed) — the document-subtype classification the AI pipeline correctly determines is thrown away at fall-creation time.
2. The two n8n workflow JSON files checked into the repo (`feldmark_fristueberwachung.json`, `feldmark_fristueberwachung_postgres.json`) are **stale relative to the live, already-fixed n8n workflows** — `KONTEXT.md` documents that the exact bugs still present in these files (comma-joined `queryReplacement`, raw-interpolated `empfaenger`, wrong table names) were fixed live in n8n, but the fixes were never re-exported to the repo. Anyone importing these files fresh (a recruiter, a new teammate, disaster recovery) gets broken workflows.

---

## Findings (prioritized)

### 1. `dokumenttyp` is hardcoded to `'pfaendungsschreiben'` for every Pfändungsblock case — Einziehungs-/Überweisungsverfügung mislabeled everywhere

**Files:**
- `feldmark_app/server/db.js:306` (`listeOffeneFaelle()`)
- `feldmark_app/server/db.js:785` (`holeAktivitaetsfeed()`)
- `feldmark_app/src/features/pfaendung-auskunftsersuchen/components/Falluebersicht.jsx:115` (consequence)

**Severity: High — live bug, fires on every request.**

`feldmark.pfaendung_faelle` has no `dokumenttyp` column (see `feldmark_pfaendung_schema.sql`), so the three sub-types it covers — `pfaendungsschreiben`, `einziehungsverfuegung`, `ueberweisungsverfuegung` (`PFAENDUNGSBLOCK_TYPEN` in `mistral.js`) — are indistinguishable once a fall is created. Both `listeOffeneFaelle()` and `holeAktivitaetsfeed()` paper over this by hardcoding the literal string `'pfaendungsschreiben' AS dokumenttyp` in their SQL, for **every** row regardless of actual type.

`dokumenttypen.js` explicitly defines distinct labels (`einziehungsverfuegung: "Einziehung"`, `ueberweisungsverfuegung: "Überweisung"`) and they render correctly at *upload time* (`stempelAusErgebnis()`, using the real `klassifikation.dokumenttyp`) — proving the mislabeling is a regression, not a deliberate simplification. Once persisted, an Einziehungsverfügung case permanently shows "Pfändung" in the Fallübersicht and Aktivitätsfeed.

This also **masks a second, latent bug**: `Falluebersicht.jsx:115` computes `istPfaendungsblock = f.dokumenttyp === "pfaendungsschreiben"` (strict equality against one string), while the filter three lines above it (`Falluebersicht.jsx:57`) correctly checks `PFAENDUNGSBLOCK.includes(f.dokumenttyp)`. Today this divergence is invisible because the API never actually returns anything but `"pfaendungsschreiben"` for that table. The moment finding #1 is fixed to report the real sub-type, every Einziehungs-/Überweisungsverfügung case would expand to an **empty detail panel** — neither `PfaendungErweiterung`, `DatendiskrepanzFall`, nor `AuskunftsersuchenErweiterung` would render, silently blocking the P-Konto/Drittschuldnererklärung workflow for those cases.

**Fix:** add a `dokumenttyp` column to `feldmark.pfaendung_faelle` (populated at fall creation from `klassifikation.dokumenttyp`), select it instead of the hardcoded literal in both queries, and change `Falluebersicht.jsx:115` to `PFAENDUNGSBLOCK.includes(f.dokumenttyp)` in the same change.

---

### 2. P-Konto checkbox has no "not yet reviewed" state — saving Guthaben alone can fire the wrong customer notification

**Files:**
- `feldmark_app/src/features/pfaendung-auskunftsersuchen/components/PfaendungErweiterung.jsx:67` (`setIstPKonto(!!f.ist_p_konto)`), `:93-111` (`speichern()`)
- `feldmark_app/server/index.js:251-272` (PUT `/api/faelle/:fallId/erweiterung`)

**Severity: High — triggers a real, documented business automation incorrectly.**

`ist_p_konto` is `NOT NULL DEFAULT false` in the schema, and the checkbox always defaults to `false` (`useState(false)`, `!!f.ist_p_konto`). `speichern()` (api.js `erweiterungSpeichern`) sends `ist_p_konto: istPKonto` **unconditionally** on every "Speichern" click, and `index.js`'s handler forwards it as a definitive boolean (`typeof ist_p_konto === "boolean" ? ist_p_konto : null` — always the boolean branch, since the frontend never omits the field).

Per the comment at `index.js:245-250`, the system is designed so that the **first time** `ist_p_konto` becomes `false` for a case, it automatically fires the P-Konto-Benachrichtigung (`index.js:262-266`) — this is meant to represent "an employee has now confirmed there's no P-Konto." But because the checkbox has no third "not yet checked" state, an employee who opens a case and saves the Guthaben amount **before** actually checking whether it's a P-Konto (a very natural order of operations) will unintentionally trigger this notification, since the checkbox is still sitting at its default `false`.

**Fix:** track whether P-Konto status has actually been reviewed (e.g. a separate boolean/timestamp, or `ist_p_konto` as a nullable tri-state that the frontend can omit until touched), and only send `ist_p_konto` in the PUT payload once the employee has explicitly interacted with the checkbox.

---

### 3. "P-Konto-Benachrichtigung ausgelöst" confirmation banner never shows on the save that triggers it

**Files:**
- `feldmark_app/src/features/pfaendung-auskunftsersuchen/components/PfaendungErweiterung.jsx:103`, `:241`
- `feldmark_app/server/index.js:254-267`

**Severity: Medium — audit-visibility gap, not data-corrupting.**

`index.js`'s PUT handler captures `aktualisiert` (via `RETURNING *`) **before** calling `db.markierePKontoBenachrichtigt()`, then returns that same stale row as `erweiterung` alongside a separately-computed `p_konto_benachrichtigung_ausgeloest: true`. `PfaendungErweiterung.jsx:103` does `setErw(erweiterung)` with that stale object (`p_konto_benachrichtigt_am` still `null`), and discards the `p_konto_benachrichtigung_ausgeloest` flag entirely — the "Speichern" button's `onClick={speichern}` never reads the returned value. The confirmation banner at line 241 (`{erw.p_konto_benachrichtigt_am && (...)`) therefore never appears on the save that actually fired the notification; it only shows up after the case is reloaded.

**Fix:** either re-fetch the erweiterung after a triggered notification, or have the PUT endpoint return the post-notification timestamp (set it before capturing `RETURNING *`, or merge it into the response).

---

### 4. n8n export `feldmark_fristueberwachung_postgres.json`: stale `queryReplacement` comma-join bug in "Protokoll schreiben (KPI-Basis)" — the exact bug KONTEXT.md says was already fixed

**File:** `feldmark_fristueberwachung_postgres.json:444` (node "Protokoll schreiben (KPI-Basis)")

**Severity: High — silent audit-trail corruption if this exported file is ever (re-)deployed.**

```
"queryReplacement": "={{ ... fall_id }}, {{ ... aktion }}, {{ ... fristende }}, {{ ... rest_tage }}, {{ ... empfaenger }}, {{ ... prioritaet }}"
```

This is a single comma-joined string mapped positionally to `$1..$6`. `empfaenger` (built at lines 208/262/316 as `"{{bearbeiter_email}}, {{vertretung_email}}"`, or 3 addresses for Eskalation) itself contains embedded commas. `KONTEXT.md` (`git show 9f59247`) explicitly documents that this exact node, in this exact workflow (`Ix9jAYFWgh73fPv9`), was found broken and fixed live — "Identischen Fix übertragen (`queryReplacement` als Array-Ausdruck statt String)" — but `git log --follow` shows this JSON file has not been touched since the very first commit (`bcbffef`). The checked-in export still has the pre-fix, broken pattern. Re-importing this file (or if it was ever re-exported without re-applying the fix) reproduces the exact bug already found and fixed once: `prioritaet` ends up holding a fragment of an email address instead of `"kritisch"`/`"hoch"`.

**Fix:** re-export the current, fixed workflow from n8n over this file (or apply the same array-based `queryReplacement` fix directly to the JSON).

---

### 5. Same file: all three Postgres nodes reference the wrong (pre-schema-reorg) table names

**File:** `feldmark_fristueberwachung_postgres.json:38, 442, 460` (nodes "Offene Faelle laden (Postgres)", "Protokoll schreiben (KPI-Basis)", "Status zurueckschreiben (Idempotenz)")

**Severity: High — would break the entire sweep outright if run against the current schema.**

All three queries reference `feldmark_pfaendung_faelle` / `feldmark_pfaendung_protokoll` (flat, unqualified names). Commit `6d8de7f` ("Supabase-Reorganisation...") moved every `feldmark_*` table into a dedicated `feldmark` schema and renamed them to `feldmark.pfaendung_faelle` / `feldmark.pfaendung_protokoll` (see `feldmark_pfaendung_schema.sql`, and `server/db.js`, which consistently uses the schema-qualified names). The commit message claims "App und beide n8n-Sweep-Workflows angepasst," but its diff (`git show 6d8de7f --stat`) touches only SQL files and `db.js` — this JSON was never updated. The file's own sticky note (line 477) even instructs the reader to run `feldmark_pfaendung_schema.sql` first — the current schema, which does **not** create a `public.feldmark_pfaendung_faelle` table. Running this workflow as checked in throws `relation "feldmark_pfaendung_faelle" does not exist` on the very first query.

**Fix:** re-export the live (already-migrated) workflow, or update all three query strings to `feldmark.pfaendung_faelle` / `feldmark.pfaendung_protokoll`.

---

### 6. Same file: `empfaenger` built via raw string interpolation, not the `.filter(Boolean).join(', ')` fix KONTEXT.md documents as already applied

**File:** `feldmark_fristueberwachung_postgres.json:208, 262, 316` (nodes "Erinnerung 1/2 aufbereiten", "Eskalation aufbereiten")

**Severity: Medium — reintroduces a literal `"null"` in recipient lists.**

`KONTEXT.md` (section "Prozessanalyse-Fixes Routing + n8n-Workflows") states: *"Beide n8n-Workflows (`Ix9jAYFWgh73fPv9`, `vAHlgWXDJXIS2cps`): Empfaenger-Felder ... nutzen jetzt `.filter(Boolean).join(', ')` statt roher String-Interpolation"* — specifically to prevent a literal `"null"` (or a dangling comma) appearing in `empfaenger` when `vertretung_email`/`vorgesetzte_email` is empty. The checked-in file still has the pre-fix form: `"={{ $json.bearbeiter_email }}, {{ $json.vertretung_email }}"`. Same stale-export root cause as findings #4 and #5.

**Fix:** re-export the live workflow, or replace the raw interpolation with the documented `.filter(Boolean).join(', ')` expression in a Code node.

---

### 7. "Fristen berechnen" Code node: `fristversaeumnis` branch has no idempotency gate, unlike the other three branches

**File:** `feldmark_fristueberwachung_postgres.json` — jsCode in node "Fristen berechnen (§ 840 ZPO)" (~line 53, `else if (restTage < 0)` branch)

**Severity: Medium — duplicate audit entries on partial failure.**

`eskalation` and `erinnerung_2` both gate on `!gesendet.includes(marker)` before firing; the `restTage < 0` branch sets `aktion = 'fristversaeumnis'` unconditionally. Idempotency then depends entirely on the downstream UPDATE's `AND NOT ($1 = ANY(erinnerungen_gesendet))` guard, which only protects the **status** write — not the earlier `INSERT INTO ... protokoll`. The workflow's own sticky note (line 493) acknowledges "Bricht der Lauf dazwischen ab, steht ein Protokolleintrag zu viel in der Tabelle" as an accepted risk for the reminder branches (guarded there), but the fristversaeumnis branch has no client-side guard at all, so a partial failure between the protokoll INSERT and the status UPDATE causes the next day's run to insert a **second** `fristversaeumnis` audit row for the same legal event — the row `KONTEXT.md`/the node's own comment calls "Grundlage für die Haftungspruefung durch Legal."

**Fix:** add `&& !gesendet.includes('fristversaeumnis')` to the `restTage < 0` branch, matching the other three.

---

### 8. `neuer_status` diverges between the mock and Postgres workflow variants — status never advances via the live sweep

**Files:** `feldmark_fristueberwachung_postgres.json:232, 286, 340` vs. `feldmark_fristueberwachung.json:229, 283, ~337`

**Severity: Medium — likely an unintended regression from the mock→Postgres port.**

The mock workflow hardcodes `neuer_status = "In Bearbeitung"` for the Erinnerung 1, Erinnerung 2, and Eskalation branches. The Postgres variant — the one described as "live"/authoritative in `db.js`'s comments — instead sets `neuer_status = "={{ $json.status }}"` (writes back the same, unchanged status) for the same three branches. The sticky note at `feldmark_fristueberwachung_postgres.json:477` explicitly claims *"Gegenüber der Mock-Variante sind genau drei Nodes getauscht ... Fristlogik und Nachrichtentexte sind unverändert"* — but this status-write logic did in fact change. As a result, in the live/Postgres workflow a case's status never progresses past `'Eingegangen'` purely from sweep activity; any reporting or logic that treats `'In Bearbeitung'` as "a reminder has gone out" will misclassify these cases as untouched even after Erinnerung 1/2/Eskalation have all fired.

**Fix:** decide whether the Postgres variant's no-op status write was intentional; if not, restore the hardcoded status advancement (or better, derive it from `aktion` in the Code node, once, instead of duplicating it per Set node).

---

### 9. Neither n8n export writes to `feldmark.sweep_status` — the Sweep-Status dashboard panel can never show "läuft"

**Files:** `feldmark_fristueberwachung.json`, `feldmark_fristueberwachung_postgres.json` (absence); `feldmark_app/server/db.js:806-811`; `feldmark_sweep_status_schema.sql`

**Severity: Low-Medium — dashboard visibility gap, not a data-correctness bug.**

`feldmark_sweep_status_schema.sql` and `db.js`'s `holeSweepStatus()` (backing `GET /api/sweep-status`, rendered by `SweepStatus.jsx`) both assume the n8n sweeps write an "erfolgreich"/"fehler" row to `feldmark.sweep_status` on every run. Neither checked-in JSON file contains any node that inserts/upserts into that table (`grep` confirms zero matches in both files). If the live workflows also lack this (plausible, since — per findings #4-6 — the exported files are known-stale copies of workflows that *have* since been patched, but sweep-status writing may simply never have been added at all, unlike the empfaenger/queryReplacement fixes which are explicitly documented as done), the Prozess-tab's Sweep-Status panel will permanently show "not yet run" even though the daily sweep is executing correctly, defeating the panel's stated purpose.

**Fix:** add a node (or two, start/end per the "optimistic" pattern the schema's comment describes) to each sweep workflow that writes `feldmark.sweep_status`, and re-export.

---

### 10. `animiertesStempel={i < ergebnisse.length}` is a tautology — dead/no-op logic

**File:** `feldmark_app/src/features/pfaendung-auskunftsersuchen/components/Posteingang.jsx:129`

**Severity: Low — cosmetic/dead code, not user-facing incorrectness beyond a missed animation.**

```jsx
{ergebnisse.map((e, i) => (
  <ErgebnisKarte key={e.id} ergebnis={e} animiertesStempel={i < ergebnisse.length} />
))}
```

For any valid array index `i`, `i < ergebnisse.length` is always `true` — the prop is unconditionally `true` for every card, on every render, including cards from a previous upload batch that are re-rendered when a second batch is prepended (`setErgebnisse((bisherige) => [...neu, ...bisherige])`). This looks like a copy/paste of `ergebnisse.length` where `neu.length` (or a per-item "just added" marker) was intended, to animate only the newly-uploaded stamps.

**Fix:** track which entries are new (e.g. tag each result with the upload batch, or compare against the previous `ergebnisse` length) and pass that instead.

---

## Not flagged / verified clean

For transparency, several plausible leads were investigated and ruled out:
- SQL status strings written by `db.js` all match their table's `CHECK` constraint (cross-checked all 4 status-bearing tables).
- The "vier Augen" bypass class of bug (empty "erfasst von"/"geprüft von" treated as "different person, unblocked") — already fixed per `KONTEXT.md`/commit `bf0cd83`, confirmed still correct in both `PfaendungErweiterung`/`AuskunftsersuchenErweiterung` and their server routes.
- `speichereErklaerung()`/`speichereAuskunftsersuchenAntwort()` correctly reset stale freigabe/versand timestamps and fall status on regeneration (the other previously-fixed bug from `bf0cd83`) — still correct.
- `api.js` request/response field names (snake_case ↔ camelCase) all match their `server/index.js` counterparts.
- `fristlogik.js` zone boundaries line up with `Fristleiste.jsx`'s E1/E2/Eskalation markers.
- No secrets committed (`.env` correctly gitignored in both root and `feldmark_app/`; only a placeholder in `.env.example`).
- `Falluebersicht.jsx`'s `PFAENDUNGSBLOCK` filter (line 57, distinct from the buggy line 115) is correct.

---

## Action-item checklist (priority order)

- [x] **#1** Add `dokumenttyp` column to `feldmark.pfaendung_faelle`; fix `listeOffeneFaelle()`/`holeAktivitaetsfeed()` + `Falluebersicht.jsx:115` together.
      **2026-08-27:** Fixed and **fully verified live**. Migration applied by the user via the Supabase SQL editor (the background fork's `apply_migration` attempt was blocked by the session's permission classifier; re-attempted from the interactive session and also blocked — user ran it manually instead). Confirmed via `information_schema` that the column + CHECK constraint landed correctly. Live-tested via real browser UI: synthetic `einziehungsverfuegung`/`ueberweisungsverfuegung` cases now show the correct label ("EINZIEHUNG"/"ÜBERWEISUNG") in Fallübersicht and the Aktivitäts-Feed, and the detail panel renders fully (the feared masked-bug regression from `Falluebersicht.jsx:115` did not occur). Test data cleaned up.
- [x] **#2** Give the P-Konto checkbox a real "not reviewed yet" state; don't send `ist_p_konto` until the employee has touched it.
      **2026-08-27:** Fixed and **fully verified live** (same migration as #1 covers `p_konto_geprueft`; backfill confirmed correct — only the one case with a pre-existing `p_konto_benachrichtigt_am` came back `p_konto_geprueft=true`). Live UI test: saving Guthaben alone leaves `p_konto_geprueft=false` and fires no notification; explicitly selecting "Kein P-Konto" sets it `true` and fires the notification, confirmed via direct DB query matching the UI timestamp exactly.
- [x] **#3** Fix the PUT `/erweiterung` response (or the frontend's use of it) so the notification-triggered save shows the confirmation banner immediately.
      **2026-08-27:** Fixed and verified — the confirmation banner ("P-Konto-Benachrichtigung ausgelöst am ...") appeared immediately in the browser on the triggering save, no reload needed.
- [x] **#4, #5, #6** Re-export both live n8n workflows over the checked-in JSON files.
      **2026-08-27:** Verified directly against the live workflow (`Ix9jAYFWgh73fPv9`) via n8n API: all three were already fixed live (array-form `queryReplacement`, schema-qualified table names, `.filter(Boolean).join(', ')` empfaenger). `feldmark_fristueberwachung_postgres.json` regenerated from the live workflow definition (31 nodes, was 17), then re-synced a second time after the #7/#8/new-bug fixes below so the file doesn't immediately go stale again. Incidental finding: the live workflow's name is `"Nickel — Pfaendung: Fristueberwachung (Postgres)"` vs. the old export's `"Feldmark Bank AG — ..."` — carried over as-is, flagged in case the rename was unintentional.
- [x] **#7** Add the missing `!gesendet.includes('fristversaeumnis')` guard.
      **2026-08-27:** Fixed live via `update_workflow` and published. **Verified with the exact partial-failure scenario the finding describes**: manually set `erinnerungen_gesendet` to include `'fristversaeumnis'` while leaving `status='Eingegangen'` (simulating a run that inserted the protokoll row but died before the status UPDATE), then re-ran the sweep — confirmed no duplicate protokoll row was created.
- [x] **#8** Decide/fix the status-advancement regression in the Postgres variant.
      **2026-08-27:** Fixed live and published, using the judgment call recorded here previously: `Eingegangen → In Bearbeitung` on first sweep contact, no downgrade of an already-advanced status. Verified live: a fresh `Eingegangen` case correctly advanced to `In Bearbeitung` on Erinnerung 1; a case already at `Geprueft` stayed at `Geprueft` after triggering Eskalation (no downgrade).
- [x] **#9** Add `feldmark.sweep_status` writes to both sweep workflows.
      **2026-08-27:** Verified live via `get_workflow_details` + a direct `SELECT * FROM feldmark.sweep_status` — already correctly implemented live for both sweeps. Zero matches in the checked-in file was pure export staleness; resolved by the re-export.
- [ ] **#10** Replace the tautological `animiertesStempel` prop with real new-item tracking. — **Out of scope** (Low severity, user asked for critical/high/medium only).

### #11 — new finding, discovered while retesting #7/#8 (not in the original review)

Fixing #8 exposed a related, pre-existing bug in the same branch cascade (not introduced by this fix — the branch order/logic was untouched): the `erinnerung_2`/`erinnerung_1` branches in "Fristen berechnen (§ 840 ZPO)" only checked their own marker in `erinnerungen_gesendet`, not whether a higher-urgency marker (`eskalation`) had already fired. In real daily operation, the day after an Eskalation fires (`restTage` drops from 1 to 0), the sweep would also fire a lower-priority Erinnerung 2 for the same case — a confusing signal-downgrade plus a redundant audit row. Reproduced live (two sweep runs against a synthetic case in the Eskalation-restTage range produced an `eskalation` row followed by a spurious `erinnerung_2` row). User approved fixing it in the same pass. Fix: both lower branches now also require the higher-urgency markers to be absent. Verified live — a third sweep run against the same already-escalated case produced no further event.

### Summary: what's actually done

Everything from this review is now fixed, applied to the live systems (Supabase + n8n), and verified against real data/executions — nothing left in a "code changed but untested" state. `#10` was explicitly out of scope per the user's request (critical/high/medium only). One additional bug (`#11`) was found and fixed during retesting, outside the original review's scope, with the user's explicit sign-off before fixing.
