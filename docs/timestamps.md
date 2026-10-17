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

That is not a limitation working around the design — it *is* the design. It just means anything
keyed to a date inherits whatever honesty the asserted date has.

## Who can lie, and what it buys them

A direct chit is issued — and signed — by the party whose position it **worsens**. Issuing raises
what you owe or lowers what you are owed. That is why chits need no countersignature: nobody needs
protection from a stranger making themselves poorer. And it is why no chit is refused for its amount:
a credit limit says what the other party will extend for goods or services, enforced by their
declining to deliver ([architecture.md § Ledger Operation](architecture.md#ledger-operation)).

So a chit's date selects nothing in the schema. What a false date can damage is the **record**, and
the counterparty's decisions that rest on it.

### Backdating

A chit dated in the past misstates when the debt arose: a statement for a period, the order a reader
sees history in, and — when rich credit terms land ([`drafts/credit-terms.md`](drafts/credit-terms.md))
— interest, which makes dates directly monetary. It can also blur which credit terms were in force
when the creditor delivered against it. Two things bound it.

- **Date order.** A chit may not be dated before the chit preceding it in the chain
  (`Ledger.DateMonotonic`). Deterministic, costs nothing, and any activity on the tally re-anchors
  the floor. On an active tally the reachable window is the gap since the last chit; on a dormant
  one it is the time since it last moved.
- **The counterparty's own clock, at receipt.** A node that receives a chit dated far from its own
  clock can decline to act on it — before shipping goods, before extending further credit. This is
  the layer where "the other party objects" actually happens, and it happens in real time, not in a
  dispute afterwards. It is agent policy, not a schema constraint, because only the agent has a
  clock it trusts.

### Postdating

Mostly self-harm, and the same kind of harm to the record: balances as of a date and history
ordering as a reader sees it. A postdated chit also raises the floor `DateMonotonic` sets for the
next one. The receiving agent should bound future dates against its own clock for the same reason it
bounds past ones.

## What this means for the schema

- Constraints key off `New.Date`, never a clock. Already true.
- `Ledger.DateMonotonic` keeps the chain in date order.
- Dates are `YYYY-MM-DD` text, checked with `IsISODate`, and compared as text, which is calendar
  order. Date arithmetic inside a constraint adds a `timespan` (`Date + timespan('P21D')`), which is
  deterministic; `julianday()` and `date()` are not, because they accept `'now'`. Only Quereus
  built-ins are used, so any Sereus node validates a tally strand without Taleus code.
- Row identifiers are supplied by the caller, never defaulted in the database. A chit's `Id` is
  inside the digest the issuer signs, so the signer must know it before the insert; a
  database-generated default could never have been signed.

## What this means for an agent

Clock policy belongs to whoever has a clock. A receiving node should:

- decline to act on a chit dated meaningfully in the future, or implausibly far in the past;
- record when it *received* a chit, separately from when the chit says it was made — the two are
  different facts and only one of them is signed;
- treat a date it accepted as a date it can no longer dispute cheaply.

None of that is in the schema, and none of it should be.
