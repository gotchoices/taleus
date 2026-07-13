----
description: Reviewed the schema for winding a tally down — either party can sign a close request, after which the ledger only accepts activity that shrinks the balance toward zero, and the tally is "closed" once the balance actually reaches zero.
prereq: feat-schema-tally-core
files: schema/draft1.qsql, docs/architecture.md, docs/old/tally.md
difficulty: medium
----

Implements `feat-schema-tally-close`. Adds the orderly wind-down of a tally to the schema:
a signed `CloseRequest` (either party, unilateral) moves the tally to **Closing**, where new
credit is frozen but balance-reducing activity is always accepted; the derived `CloseState`
view reads **Closed** only once the settled balance is genuinely zero with no pending lift in
flight. Two new "move toward zero" constraints enforce the freeze — one on direct chits, one on
lift pledges.

## What landed (all in `schema/draft1.qsql` + `docs/architecture.md`)

- **`CloseRequest` table** (after `CreditTerms`, before the views block). `primary key (Requester)`
  → at most one row per party; either or both may file, either alone is enough. Mirrors the
  `Invoice` / `InvoiceDecline` signer pattern: `SignerKey` resolves against the requesting side's
  own `AuthorizedKey` set; `Signature` over the `Cid`-bound digest `Digest(Cid, Requester, Date)`
  so a request can't be replayed into another tally. Insert-only. Carries the **reopen/withdraw
  tripwire NOTE** (no supersede path today).
- **`CloseState` view** (after `OpenPendingLift`). `open` (no `CloseRequest` row) / `closing`
  (row exists, not a stable zero) / `closed` (settled `Ledger.Balance` = 0 **and** no
  `OpenPendingLift`). Uses the **settled** balance, not reserved, so a finalize can never unsettle
  a `closed` reading; the open-pledge test is what makes `closed` a stable terminal state.
- **`Ledger.ClosingReducesBalance`** — while any `CloseRequest` exists, a new **direct** chit may
  only move the settled balance toward zero. `Kind = 'lift'` (finalize) is exempt (same atomicity
  reason as the two credit gates). Same-sign / bounded form (no `abs()`), so a sign-flip overshoot
  (+30 → −5) is rejected. At prior balance = 0 both arms are false → every direct insert rejected,
  which *is* the Closed "no further ledger inserts" rule with no separate constraint.
- **`PendingLift.ClosingReducesReserved`** — a new pledge during Closing must shrink the
  **reserved** balance toward zero (settled gate on chits, reserved gate on pledges — same split as
  the two credit gates). No finalize exemption (a pledge insert is never a finalize).
- Both gates carry the **shared-isolation NOTE** pointing at `PartyKeyRevocation.NotLastKey`
  (`schema/draft1.qsql:137-146`) — the closing gates are commit-time deferred CHECKs reading
  `exists (select 1 from CloseRequest)`, same open Optimystic-snapshot question, not re-solved here.
- **Docs** — Tables table gains a `CloseRequest` row; the views paragraph mentions `CloseState`;
  the Tally Lifecycle table's Closing/Closed cells now name the schema mechanism, with a note that
  Closing/Closed are schema-backed while Forming/Open/Void are not materialized, plus the Sereus
  archival bullet (requirement 6). A new **"Tally close"** subsection under § Ledger Operation
  states the unilateral-close semantics and the zero-credit-vs-close distinction, cross-linking
  `docs/old/tally.md` § *Important Distinction: Zero Credit vs. Close Request*.

## Validation done (machine, not just static)

The ticket assumed static validation ("no Quereus runner wired"). It went further: loaded the
schema through Quereus's own parser + `Database` DDL binder (built engine at
`../quereus/packages/quereus/dist`, stub scalar funcs for `Digest`/`SignatureValid`/`ValidDate`/
`ValidDenomination`/`RandomUUID` + a deterministic `julianday`, statements reordered tables-first
because the file defines views before their base tables).

- **Parse: OK** — 29 statements (17 tables + 12 views), +2 vs. pre-ticket (`CloseRequest`,
  `CloseState`). No syntax error anywhere in the file.
- **Bind: 28/29** — **every new object binds**, and CHECK bodies bind **eagerly** here (contra the
  lift-chits handoff's "lazy" assumption), so `ClosingReducesBalance` / `ClosingReducesReserved`
  were actually type-checked against real columns/subqueries at `CREATE TABLE` and passed.
  `CloseRequest`, `CloseState`, `Ledger`, `PendingLift` all bind clean.
- **The single bind failure is pre-existing `LiftLading :: Function not found: max/2`** —
  scalar 2-arg min/max, tracked in `backlog/debt-schema-liftlading-scalar-minmax`, untouched here.

## Test spec — accept/reject expectations for a future runner (the floor, NOT yet exercised)

These are **not** run (see gaps below). Write them as the behavioral floor when a runner + key
bootstrap exist. `P` = prior settled balance, `B` = new balance; `PR`/`NR` = prior/new reserved.

Direct-chit closing gate (`ClosingReducesBalance`):
- Close filed at zero balance → immediately `closed`; next direct chit **rejected** (P = 0, both arms false).
- Closing, chit +30 → −5 (sign-flip overshoot), both directions → **rejected**.
- Closing, chit +50 → 0 → **accepted** (P > 0, B = 0, 0 < P); `CloseState` then reads `closed` (no open pledge).
- Closing, chit growing balance (new credit), S-issued and F-issued → **rejected** both.
- Lift **finalize** (`Kind='lift'`) during Closing → **accepted regardless of direction** (exempt); assert it commits while `CloseState='closing'`, and `CloseState` reflects the post-finalize settled balance.
- Reducing chit during Closing still passes `WithinCreditLimits` + `WithinReservedCredit` → assert one reducing chit passes all three gates (they stack, no conflict).

Pledge closing gate (`ClosingReducesReserved`):
- Closing, pledge growing reserved magnitude → **rejected**.
- Closing, pledge shrinking reserved toward zero (the "lift my balance out" path) → **accepted**.

`CloseState` / table:
- `CreditTerms.CreditLimit = 0` with no `CloseRequest` → `CloseState = 'open'`, reducing/lift activity still flows (zero credit ≠ close).
- Settled 0 but an `OpenPendingLift` in flight → `closing`, not `closed`; becomes `closed` only after the pledge finalizes/voids and settled is 0.
- Both parties file → two `CloseRequest` rows (S, F), still `closing`; a duplicate from the same party rejected by `primary key (Requester)`.
- Close request signed by a non-authorized / wrong-party key → rejected by `SignerAuthorized` / `SignatureValid`.

## Known gaps (reviewer: treat tests as a floor)

- **Behavioral insert-level testing is NOT done** — only DDL bind. The accept/reject spec above is
  unexercised.
- **Direct-chit behavioral testing is blocked by a pre-existing defect**: `Ledger.ValidIssuer`
  references a non-existent `IssuerSid` column (draft placeholder, flagged in the lift-chits
  handoff for triage, `schema/draft1.qsql` ValidIssuer). Any direct-chit insert trips it before
  `ClosingReducesBalance` is reached, so the direct-chit gate cannot be behaviorally tested until
  that lands. The pledge gate (`PendingLift`) and `CloseState` are testable without it, once the
  signature-gated-insert scaffolding (Stock/Foil/PartyKey genesis → TallyCore → CreditTerms → a
  valid pledge) is built with stub crypto.
- **`BalanceCorrect` reference-form nuance** (noticed, pre-existing, not mine): `BalanceCorrect`
  writes the prior-row lookup as `where Number = Number - 1` (unqualified), which resolves both
  sides to the inner `Ledger.Number` (always false → prior treated as 0). The two new closing
  gates deliberately write `New.Number - 1` (the correct disambiguation) per the ticket. Not
  touched here — pre-existing and out of scope; noted for whoever exercises the settled chain.
- **Reopen/withdraw a close request is out of scope** — parked as a tripwire NOTE at the
  `CloseRequest` table, no ticket filed (file a `backlog/feat-` only if a concrete need surfaces).
- **Strand hibernation/archival on Closed** is documented as a Sereus/app-layer action, not a
  schema constraint (requirement 6) — no enforcement added, by design.

## Tripwires recorded (index — analysis lives at the sites)

- **Commit-time isolation of the closing gates** — same open Optimystic-snapshot question as
  `PartyKeyRevocation.NotLastKey` / `InvoiceLink` / `LiftFinalize`. `NOTE:` at both closing gates.
- **No reopen/withdraw path for a close request** — `NOTE:` at the `CloseRequest` table.
