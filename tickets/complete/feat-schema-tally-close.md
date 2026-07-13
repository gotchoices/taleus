----
description: Reviewed and accepted the schema for winding a tally down — either party can sign a close request, after which the ledger only accepts activity that shrinks the balance toward zero, and the tally is "closed" once the balance actually reaches zero.
files: schema/draft1.qsql, docs/architecture.md, docs/old/tally.md, tickets/backlog/debt-deferred-constraint-snapshots.md
----

Archived summary of `feat-schema-tally-close`. Adds an orderly tally wind-down to the schema:
a signed `CloseRequest` (either party, unilateral) moves the tally to **Closing**, where new
credit is frozen but balance-reducing activity is always accepted; the derived `CloseState` view
reads **Closed** only once the settled balance is genuinely zero with no pending lift in flight.
Two "move toward zero" gates enforce the freeze — `Ledger.ClosingReducesBalance` (direct chits)
and `PendingLift.ClosingReducesReserved` (lift pledges).

Implementation landed clean; review found no defects in the new code. See `## Review findings`.

## What landed

- **`CloseRequest` table** — `primary key (Requester)` (at most one row per party; either alone is
  enough). Mirrors the `Invoice` / `InvoiceDecline` signer pattern: `SignerKey` resolves against the
  requesting side's own `AuthorizedKey` set; `Signature` over the `Cid`-bound digest
  `Digest(Cid, Requester, Date)` so a request can't be replayed into another tally. Insert-only.
- **`CloseState` view** — `open` (no `CloseRequest` row) / `closing` (row exists, not a stable zero)
  / `closed` (settled `Ledger.Balance` = 0 **and** no `OpenPendingLift`). Reads the **settled**
  balance so a finalize can never unsettle a `closed` reading.
- **`Ledger.ClosingReducesBalance`** — while any `CloseRequest` exists, a new **direct** chit may
  only move the settled balance toward zero. `Kind = 'lift'` finalize is exempt (atomicity). At prior
  balance = 0 both arms are false → every direct insert rejected, which is the Closed "no further
  inserts" rule with no separate constraint.
- **`PendingLift.ClosingReducesReserved`** — a new pledge during Closing must shrink the **reserved**
  balance toward zero (settled gate on chits, reserved gate on pledges).
- **Docs** — `docs/architecture.md`: Tables row for `CloseRequest`, views paragraph mentions
  `CloseState`, Tally Lifecycle table's Closing/Closed cells name the schema mechanism (with the
  schema-backed vs. not-materialized note and the Sereus archival bullet), plus a new **"Tally
  close"** subsection cross-linking `docs/old/tally.md` § *Important Distinction: Zero Credit vs.
  Close Request* (target confirmed present, `docs/old/tally.md:275`).

## Review findings

**What was checked, and the disposition of each.**

### Bind / load (machine-verified, not just static)
Rebuilt the implementer's parse+bind harness (Quereus engine at `../quereus/packages/quereus/dist`,
stub scalar funcs `Digest`/`SignatureValid`/`ValidDate`/`ValidDenomination`/`RandomUUID` + a
deterministic `julianday`, statements reordered tables-first) and re-ran it against the committed
schema. **Reproduced the handoff result exactly: 28/29 objects bind.** `CloseRequest`, `CloseState`,
`ClosingReducesBalance`, and `ClosingReducesReserved` all bind (CHECK bodies type-check eagerly). The
sole failure is the pre-existing `LiftLading :: Function not found: max/2`, untouched here and tracked
in `backlog/debt-schema-liftlading-scalar-minmax`. Harness was scratch — not committed.

### Closing-gate algebra (adversarial trace, both gates) — **correct, no findings**
Traced both gates across positive/negative balances, exact-to-zero, sign-flip overshoot, and
zero-balance cases:
- `ClosingReducesBalance`: reduce +50→+20 accepted; +50→0 accepted; +30→−5 (overshoot) rejected;
  at P=0 every insert rejected; finalize (`Kind='lift'`) exempt regardless of direction. Correctly
  uses `Number = New.Number - 1` for the prior-row read (**not** the always-false `Number = Number - 1`
  form of the pre-existing `BalanceCorrect` bug).
- `ClosingReducesReserved`: reduce a positive/negative reserved toward zero accepted; overshoot past
  zero rejected; at reserved=0 no new pledge accepted. The `ReservedBalance`-includes-the-new-pledge
  assumption matches the existing `WithinReservedCredit` gate's use of the same plain ref.

### `CloseState` 'closed' stability — **correct, no findings**
Confirmed `closed` is a stable terminal state: at settled=0 during Closing, `ClosingReducesBalance`
rejects all direct chits and `ClosingReducesReserved` rejects all new pledges, and `closed` requires
no open pledge — so nothing can bump a `closed` tally back off zero. The open-pledge test is
load-bearing and present.

### Signer / signature / insert-only — **correct, no findings**
`CloseRequest` matches the `Invoice`/`InvoiceDecline` pattern: `SignerAuthorized` resolves the signer
against the requesting side's `AuthorizedKey`, `SignatureValid` over the `Cid`-bound digest,
`InsertOnly` on delete/update, `primary key (Requester)` rejects a duplicate from the same party.

### Docs — **correct, no findings**
Read every touched doc region. `architecture.md` Tables/views/lifecycle edits and the new "Tally
close" subsection reflect the schema. The `docs/old/tally.md` cross-link target exists.

### Minor finding — **fixed inline**
The two new closing gates read `Ledger`/`CloseRequest` with plain refs and share the deferred-snapshot
(`committed.*`) concern that `backlog/debt-deferred-constraint-snapshots` is the canonical fix for,
but that ticket's "Sites to fix" list did not mention them — so a future snapshot fix would convert
`BalanceCorrect` and miss the identical construct in `ClosingReducesBalance`/`ClosingReducesReserved`.
**Added both gates to that ticket's site list** (`tickets/backlog/debt-deferred-constraint-snapshots.md`)
with the exact conversions (`committed.Ledger` prior-row read, `committed.CloseRequest` existence
checks). No schema change — the isolation question is genuinely deferred, and the inline `NOTE:`
tripwires at both sites remain.

### Pre-existing defects encountered — **all already tracked, none re-filed**
- `Ledger.ValidIssuer` references a non-existent `IssuerSid` column → `backlog/debt-schema-core-tables`.
  Blocks direct-chit *behavioral* insert testing (any direct chit trips it before the closing gate),
  so the accept/reject spec below stays unexercised until it lands.
- `Ledger.BalanceCorrect` prior-row lookup `Number = Number - 1` is always false → tracked in
  `backlog/debt-deferred-constraint-snapshots`. `CloseState`'s `closed` path depends on a correct
  settled chain, so it is non-functional until this lands (dependency, not a new defect).
- `LiftLading :: max/2` scalar min/max → `backlog/debt-schema-liftlading-scalar-minmax`.

### Empty categories (explicit)
- **No major findings** — nothing warranting a new fix/plan ticket. The closing logic is sound and the
  only blockers to further testing are pre-existing and already ticketed.
- **No new tests written** — this is a design-phase schema with **no runner or build** (`AGENTS.md`:
  "No package/build scaffolding yet"). The strongest available validation is DDL bind, which passes.
  Behavioral insert-level accept/reject testing (spec below) is the floor for the first runner
  milestone and is blocked on `debt-schema-core-tables` (`ValidIssuer`) for the direct-chit gate; the
  pledge gate and `CloseState` are testable earlier once signature-gated-insert scaffolding exists.

## Tripwires (recorded at sites, indexed here — analysis lives at the code)
- **Commit-time isolation of the closing gates** — inline `NOTE:` at both `ClosingReducesBalance` and
  `ClosingReducesReserved`; also now listed as fix sites in `debt-deferred-constraint-snapshots`.
- **No reopen/withdraw path for a close request** — inline `NOTE:` at the `CloseRequest` table; no
  ticket filed (add a `backlog/feat-` only if a concrete need surfaces).
- **`ClosingReducesReserved` reads `ReservedBalance` five times per insert** — noticed, **no action**:
  it is a once-per-insert CHECK and `ReservedBalance` is a cheap sum over the open-pledge set; not
  worth hoisting or a code comment. Recorded here only so a future reader knows it was considered.

## Test spec — accept/reject floor for a future runner (NOT yet exercised)
`P` = prior settled balance, `B` = new balance; `PR`/`NR` = prior/new reserved.

Direct-chit gate (`ClosingReducesBalance`): close at zero → next direct chit rejected (P=0);
+30→−5 overshoot rejected; +50→0 accepted then `CloseState='closed'`; growing chit (either issuer)
rejected; finalize (`Kind='lift'`) accepted regardless of direction while `CloseState='closing'`; a
reducing chit stacks cleanly with `WithinCreditLimits` + `WithinReservedCredit`.

Pledge gate (`ClosingReducesReserved`): pledge growing reserved magnitude rejected; pledge shrinking
reserved toward zero accepted.

`CloseState` / table: `CreditLimit=0` with no `CloseRequest` → `open`, activity still flows (zero
credit ≠ close); settled 0 with an `OpenPendingLift` → `closing` not `closed`, becomes `closed` after
the pledge resolves; both parties file → two rows, duplicate from one party rejected by
`primary key (Requester)`; close signed by a non-authorized/wrong-party key rejected by
`SignerAuthorized`/`SignatureValid`.
