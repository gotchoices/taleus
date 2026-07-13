----
description: Add the orderly wind-down of a tally to the schema — either party can sign a close request, after which the ledger only accepts activity that shrinks the balance until it hits zero and the tally is closed.
prereq: feat-schema-tally-core
files: schema/draft1.qsql, docs/architecture.md, docs/old/tally.md
difficulty: medium
----

Model the tally lifecycle states **Closing** and **Closed** (docs/architecture.md § Tally Lifecycle) in the schema. Today they have no backing: there is no close-request table and nothing restricts chits during wind-down. Add a signed `CloseRequest` table, a derived `CloseState` view, and two "move toward zero" constraints (one on `Ledger` direct chits, one on `PendingLift` pledges).

The lift-chit machinery this builds on already landed (`Ledger.Kind`, `PendingLift`, `LiftVoid`, `ReservedBalance`, `OpenPendingLift` — see `schema/draft1.qsql`). `TallyCore` is referenced by every table but is only being *defined* by the sibling `feat-schema-tally-core`; this ticket follows the same `(select Cid from TallyCore)` / `StockSid` / `FoilSid` reference pattern as its siblings and is chained behind that ticket.

**No Quereus runner is wired yet** (same state as `feat-schema-lift-chits`, `feat-denomination-argument`, etc.). Validation is static — constraint reasoning + review against the house patterns — not a live execute. The TDD bullets below state the accept/reject behavior a future runner must reproduce; write them as comments/expectations, do not skip on the absence of a runner. Do **not** attempt to make the whole draft schema load (it already does not: `TallyCore` undefined, `LiftLading` scalar `min/max` — `backlog/debt-schema-liftlading-scalar-minmax`); those are out of scope.

## Design (resolved)

### Unilateral close is sufficient — and cannot trap value

A single signed `CloseRequest` row from **either** party moves the tally to **Closing**. It is *not* bilateral, and that is safe, because Closing does only two things:

- **Freezes balance growth.** No new chit (from either side) may move the balance *away* from zero — i.e. no new credit is extended in either direction. This is a right each party already holds unilaterally (set `CreditTerms.CreditLimit` to the current balance). Freezing the counterparty's ability to *extend* credit takes nothing the counterparty is owed.
- **Drives toward zero.** Balance-*reducing* activity — direct chits **and** lifts — is always accepted, from either party, so the party that holds a positive balance can always be paid down or lift its value out elsewhere in the graph.

A unilateral close therefore never traps the counterparty: **Closed** is only reached once the settled balance is *actually* zero (and no pending lift is still in flight), so nobody's positive balance is ever forcibly stranded — it stays fully recorded and collectible while the tally sits in Closing. The unacceptable design the plan ticket warned about (a unilateral close that blocks the creditor from reducing/lifting out its balance) is explicitly avoided by always accepting balance-reducing direct chits and lift pledges.

Both parties **may** each file a close request (`primary key (Requester)` → at most one per party); either one alone is enough. Presence of any `CloseRequest` row ⇒ Closing.

### Zero credit terms ≠ close (requirement 4)

Setting `CreditTerms.CreditLimit = 0` leaves the tally **Open**: no `CloseRequest` row exists, so `CloseState` is `open`, the balance may still be paid down, lifts still run, and credit can be restored by a later `CreditTerms` revision. Close is a *distinct, separately-signed* state (its own table), never a terms revision. This falls out for free by making close its own table — just assert it in a test.

### Strand lifecycle interaction (requirement 6)

Once `CloseState = 'closed'`, the strand may be **permanently hibernated / archived via Sereus**; the insert-only, replicated data remains as dispute evidence. This is a Sereus/app-layer action, **not** a schema constraint — document it as a bullet in architecture.md, add no enforcement here.

## Schema

### `CloseRequest` (new table)

```
create table CloseRequest (
    Requester text check (Requester in ('S','F')),  -- party requesting closure
    Date text check (ValidDate(Date)),
    SignerKey text,        -- authorized PartyKey of the requesting party
    Signature text,        -- requester signs Digest(Cid, Requester, Date)

    primary key (Requester),   -- at most one close request per party; either or both may file
    constraint SignerAuthorized check on insert (New.SignerKey in (
        select PublicKey from AuthorizedKey AK
        where AK.Sid = (select case when New.Requester = 'S' then StockSid else FoilSid end from TallyCore)
    )),
    constraint SignatureValid check on insert (SignatureValid(
        Digest((select Cid from TallyCore), Requester, Date),
        Signature, New.SignerKey
    )),
    constraint InsertOnly check on delete, update (0)
);
```

Mirror the `Invoice` / `InvoiceDecline` signer pattern exactly (SignerKey resolves against the requesting side's own `AuthorizedKey` set; Cid-bound digest so a close request can't be replayed into another tally).

### `CloseState` (new view)

Three states. Use the **settled** balance (raw `Ledger.Balance`, latest row) for the zero test, and require **no open pending lift** so `closed` is a stable terminal state a finalize can't bump off zero:

```
create view CloseState as
  select case
    when not exists (select 1 from CloseRequest) then 'open'
    when coalesce((select Balance from Ledger order by Number desc limit 1), 0) = 0
         and not exists (select 1 from OpenPendingLift) then 'closed'
    else 'closing'
  end as State
  from TallyCore;   -- single row
```

`'open'` here means "no close request filed" — it does **not** attempt to distinguish Forming / Open / Void (those depend on contract/formation state that the schema does not materialize today; out of scope, note it).

### Closing gate on `Ledger` direct chits (new constraint)

New chits may only shrink the settled balance toward zero while a close request is in force. Finalized lifts (`Kind = 'lift'`) are **exempt** — same reasoning as `WithinCreditLimits` / `WithinReservedCredit`: a referee-committed finalize must always settle or cross-strand atomicity breaks; the pledge was gated when made.

Let `P` = prior settled balance (`coalesce((select Balance from Ledger where Number = New.Number - 1), 0)`, matching `BalanceCorrect`'s reference form) and `B` = `New.Balance`. "Toward zero, no sign-flip overshoot" is:

```
constraint ClosingReducesBalance check on insert (
    New.Kind = 'lift'                            -- finalize exempt (atomicity)
    or not exists (select 1 from CloseRequest)   -- not Closing → unrestricted
    or (P > 0 and B >= 0 and B < P)              -- reduce a positive balance toward 0
    or (P < 0 and B <= 0 and B > P)              -- reduce a negative balance toward 0
);
```

Prefer this same-sign / bounded form over `abs()` — it needs no `abs` (Quereus availability unconfirmed) and forbids sign-flip overshoot (a chit that would flip +30 → −5 creates *new* opposite-direction credit, contradicting "no new credit"). At `P = 0` both arms are false ⇒ every insert rejected ⇒ this is exactly the **Closed** "no further ledger inserts" rule (requirement 3), with no separate constraint. Inline `P` (the subquery) at each use.

### Closing gate on `PendingLift` pledges (new constraint)

A new pledge during Closing must shrink the **reserved** balance toward zero (mirrors putting the direct-chit gate on settled, the pledge gate on reserved — same split as the two credit gates). `ReservedBalance` read with a plain ref already includes this new pledge, so let `NR` = `(select Balance from ReservedBalance)`, `D` = `New.Units * case when New.Issuer = 'F' then 1 else -1 end` (this pledge's delta), and prior reserved `PR = NR - D`:

```
constraint ClosingReducesReserved check on insert (
    not exists (select 1 from CloseRequest)
    or (PR > 0 and NR >= 0 and NR < PR)
    or (PR < 0 and NR <= 0 and NR > PR)
);
```

Inline `NR` / `D` / `PR`. No finalize exemption applies here (a `PendingLift` insert is always a fresh pledge, never a finalize). `LiftVoid` needs no closing gate — a void only releases reservation.

## Edge cases & interactions

- **Close filed at zero balance** → immediately `closed`; the next direct chit is rejected by `ClosingReducesBalance` (P = 0). Assert.
- **Sign-flip overshoot** — direct chit that would move +30 → −5 while Closing: **rejected** (same-sign clause). Assert both directions.
- **Reach exactly zero** — chit +50 → 0 while Closing: **accepted** (`B = 0`, `P > 0`, `0 < P`); `CloseState` then reads `closed` (provided no open pending lift). Assert.
- **Lift finalize during Closing** — a `Kind = 'lift'` finalize is **accepted regardless of direction** (exempt), even if it moves the settled balance *away* from zero (case: a magnitude-growing pledge legitimately made while Open, close filed, referee commits after). Atomicity trumps. Assert a finalize commits while `CloseState` is `closing`, and that `CloseState` correctly reflects the post-finalize settled balance.
- **New magnitude-growing pledge during Closing** — `PendingLift` that would grow reserved magnitude: **rejected** by `ClosingReducesReserved`. Assert.
- **New reducing pledge during Closing** — a `PendingLift` that shrinks reserved toward zero: **accepted** (the "lift my balance out" path). Assert.
- **Direct chit growing balance during Closing** (new credit, either issuer): **rejected**. Assert for both S- and F-issued.
- **Both parties file close** — two `CloseRequest` rows (S and F); still `closing`; the `primary key (Requester)` rejects a *duplicate* from the same party. Assert.
- **Zero credit terms ≠ close** — with `CreditTerms.CreditLimit = 0` and no `CloseRequest`, `CloseState` = `open` and reducing/lift activity still flows. Assert.
- **Closed stability with an open pledge** — settled balance 0 but an `OpenPendingLift` still in flight ⇒ `CloseState` = `closing`, not `closed` (a finalize could still move settled off zero); becomes `closed` only after the pledge finalizes/voids and settled is 0. Assert.
- **Unauthorized / wrong-key close request** — `SignerAuthorized` / `SignatureValid` reject a request signed by a non-authorized key or the wrong party's key. Assert.
- **Closing gate coexists with credit gates** — a reducing direct chit still passes `WithinCreditLimits` / `WithinReservedCredit` (reducing magnitude never exceeds a limit that already admitted the larger balance); the constraints stack without conflict. Assert one reducing chit passes all three.
- **Concurrency / isolation** — the closing gates are commit-time deferred CHECKs reading `exists (select 1 from CloseRequest)`. A balance-growing chit whose transaction read-snapshot predates the close-request commit could slip through if Optimystic validates only against the original read snapshot. This is the **same** open isolation question already flagged for `PartyKeyRevocation.NotLastKey` (schema/draft1.qsql:137-146) and `Ledger.InvoiceLink` / `LiftFinalize` — **do not re-solve it here**; add a one-line NOTE at the closing gates pointing at that shared caveat.
- **Reopen / withdraw a close request is OUT OF SCOPE** — insert-only tables carry no supersede path, and restoring balance-growth is the requester relaxing its own restriction (arguably its unilateral right, but it touches the counterparty's expectations). Not built here. Record it as a **tripwire NOTE** at the `CloseRequest` table (`// NOTE: no reopen/withdraw path; if wind-down needs to be reversible, add a signed CloseWithdrawal that supersedes — see backlog if it comes up`), and file a `backlog/feat-` ticket only if a concrete need surfaces — not now.

## Docs

- **docs/architecture.md § Tally Lifecycle** table (lines ~330-337): note that Closing/Closed are now schema-backed (`CloseRequest` + `CloseState` + the two closing gates).
- **docs/architecture.md § Schema and Integrity Model** *Tables* table (lines ~95-112): add a `CloseRequest` row; the views paragraph (line ~114) should mention `CloseState`.
- Add a short **"Tally close"** subsection (under § Ledger Operation, near the credit-gate prose) stating the resolved unilateral-close semantics: what Closing freezes, what it always permits, why it cannot trap value, why Closed requires a genuine zero settled balance with no pending lift, and the zero-credit-vs-close distinction (cross-link `docs/old/tally.md` § Zero Credit vs. Close Request).
- Keep prose timeless; no TODO sections in docs (house rule).

## TODO

- Add the `CloseRequest` table to `schema/draft1.qsql`, after `PartyCertificate` / near the negotiation-state tables (place it before `Ledger` so its name resolves for any forward reference; views resolve at statement-build time regardless). Follow the `Invoice` signer/digest pattern.
- Add the `CloseState` view (place after `OpenPendingLift`, since it references it).
- Add `ClosingReducesBalance` to `Ledger` and `ClosingReducesReserved` to `PendingLift`, inlining the balance subqueries; add the shared-isolation NOTE and the reopen tripwire NOTE.
- Update the three architecture.md locations and add the "Tally close" subsection.
- Write the accept/reject expectations from *Edge cases & interactions* as the test spec (comments / a test list) for when a Quereus runner lands — do not disable anything for the missing runner.
