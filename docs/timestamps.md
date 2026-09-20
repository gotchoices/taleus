# Timestamps

Every dated record in Taleus carries a time its **creator asserted and signed**. There is no clock
authority, no notary, and no consensus on "now". This page says why that is the only workable answer
for direct chits, what it costs, and what bounds the cost.

Lifts are out of scope here: a distributed lift has a referee already, and time-bounding a lift is
that referee's problem ([`architecture.md` § Referee model](architecture.md#referee-model-and-the-commit-seam)).

## Why the creator asserts the time

A two-party tally has exactly two participants and no third. Any other source of time would have to
be either the counterparty (who has the same incentive to lie, in the other direction) or an outside
authority (which Taleus does not have and does not want). So the creator signs a time, the
counterparty reads it, and **the counterparty's recourse is to object** — not to a constraint, but to
their partner, in the ordinary way people dispute a dated receipt.

This has a consequence worth stating plainly: **a date in Taleus is evidence, not proof.** It is a
signed assertion by one party, and both parties hold it. It is exactly as good as a date written on
a paper invoice, which is to say good enough for almost everything and worthless against a determined
liar who is never challenged.

## Why the constraints cannot use `now()`

Quereus rejects non-deterministic expressions in `CHECK` constraints and column defaults, and it is
right to. Every replica of a strand re-validates every write. A constraint that reads the clock would
have each replica reach a different verdict on the same row, and the strand would diverge. Anything
time-dependent in a gate therefore has to come from a value **in the row**, which means a value the
signer chose.

That is not a limitation working around the design — it *is* the design. It just means the gates
inherit whatever honesty the asserted date has.

## Who can lie, and what it buys them

A direct chit is issued — and signed — by the party whose position it **worsens**. Issuing raises
what you owe or lowers what you are owed. That is why chits need no countersignature: nobody needs
protection from a stranger making themselves poorer.

What the issuer *does* consume is the credit the **other** party granted. `Ledger.WithinCreditLimits`
picks the grantor's limit from the highest-revision `CreditTerms` row whose `EffectiveDate` is on or
before **the chit's own signed date**. So the date the issuer chooses selects which credit epoch
governs. That is the whole attack surface.

### Backdating

The real one. A grantor reduces a limit; the reduction takes effect after the notice period the
grantor previously agreed to (`CreditTerms.EffectiveDateValid`). Once it is in force, an issuer can
still date a chit *before* it and have the gate apply the older, larger limit.

The loss is genuine: the grantor is owed more than they now consent to risk, and cannot un-owe it.
Two things bound it.

- **Date monotonicity.** A chit may not be dated before the chit preceding it in the chain
  (`Ledger.DateMonotonic`). Deterministic, costs nothing, and it means any activity on the tally
  re-anchors the floor. On an active tally the reachable window is the gap since the last chit.
- **The counterparty's own clock, at receipt.** A node that receives a chit dated far from its own
  clock can refuse to accept it before acting on it — before shipping goods, before extending
  further credit. This is the layer where "the other party objects" actually happens, and it happens
  in real time, not in a dispute afterwards. It is agent policy, not a schema constraint, because
  only the agent has a clock it trusts.

The residual exposure, stated honestly: **a dormant tally.** If two parties have not transacted in a
year, monotonicity permits a chit dated a year back, and the grantor's reduction in the meantime can
be stepped around. The designed protection there is the notice period itself — a grantor reducing a
limit on a dormant tally should expect the old limit to remain reachable until the tally moves — plus
the receiving agent's clock check.

### Postdating

Much weaker, and mostly self-harm. A future date selects a future credit epoch, and future epochs
are *more restrictive* by construction: permissive changes take effect immediately, so they are
already in force, while restrictive ones are the only kind that sit in the future. The one exception
is a grantor who voluntarily files a permissive increase with a future effective date; a grantor who
does not want that reached early should not file it early.

What postdating does damage is the **record**: balances as of a date, history ordering as a reader
sees it, and — when rich credit terms land ([`drafts/credit-terms.md`](drafts/credit-terms.md)) —
interest and amortization, which make dates directly monetary. The receiving agent should bound
future dates against its own clock for the same reason it bounds past ones.

## What this means for the schema

- Gates key off `New.Date`, never a clock. Already true.
- `Ledger.DateMonotonic` bounds how far back a chit may reach.
- Date arithmetic and comparison inside constraints go through the deterministic host scalar
  `DayNumber(date)` rather than `julianday()`, which Quereus classifies as non-deterministic because
  it accepts `'now'`.
- Row identifiers are supplied by the caller, never defaulted in the database. A chit's `Id` is
  inside the digest the issuer signs, so the signer must know it before the insert; a
  database-generated default could never have been signed.

## What this means for an agent

Clock policy belongs to whoever has a clock. A receiving node should:

- reject a chit dated meaningfully in the future, and one dated implausibly far in the past, before
  acting on it;
- record when it *received* a chit, separately from when the chit says it was made — the two are
  different facts and only one of them is signed;
- treat a date it accepted as a date it can no longer dispute cheaply.

None of that is in the schema, and none of it should be.
