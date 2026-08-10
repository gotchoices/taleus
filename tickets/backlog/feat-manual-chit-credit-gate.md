description: Let someone promise to pay more than their partner agreed to be owed — warning both people rather than refusing the entry — since a promise costs the person receiving it nothing.
files: packages/taleus/schema/draft1.qsql, packages/taleus-app/design/stories/mobile/20-pay-a-partner.md, packages/taleus-app/design/specs/domain/rules.md, docs/architecture.md
difficulty: medium
----
## Why this ticket exists

Today a manual chit is refused outright if it would take the balance past either party's credit
limit — `Ledger.WithinCreditLimits` and `WithinReservedCredit` are hard CHECK constraints
(`packages/taleus/schema/draft1.qsql:862`). The proposal is to stop refusing manual chits on that
basis and warn instead.

The reasoning is that a chit is a **promise by the person making it**. Whoever receives it has given
up nothing — they hold a claim they did not ask for, and they remain free to decline to hand over
goods or services for it. It is the paper-cheque situation: anyone may write a cheque for any amount,
and no vendor is obliged to sell anything in exchange for it. Refusing to record the promise protects
nobody, and it blocks legitimate uses where the parties are content to go past a stale limit.

There is also a practical objection to gating at all: the limit is tested against an **aggregate
balance**, while a chit carries only its own amount. With other chits or lifts in flight, the check
is right most of the time and wrong occasionally — so it cannot be relied on as a guarantee even
today. Better to give the decision to the party who can actually judge it.

## Outcomes we're after

- A party can record a promise to pay at any time, for any amount, without the system refusing it.
- The party making the promise is told when it goes beyond what their counterparty agreed to be owed,
  and how far.
- **The counterparty is told too, at the moment it matters to them** — when they are deciding whether
  to hand over goods. This is arguably the more important of the two warnings.
- Nobody reads a limit as a guarantee. It records what a party agreed to, not what the other party is
  able to promise.
- Lifts are unaffected: automated clearing continues to respect both parties' limits, because there
  the party is not choosing in the moment.
- Closing is unaffected: a closing tally still refuses anything moving the balance away from zero.
  That is a freeze on direction, a separate rule from credit limits, and it should survive this
  change untouched.

## Knock-on effects to check

- **`debt-credit-gate-chit-date-backdating` largely dissolves.** That ticket exists because an issuer
  can backdate a chit to select an older, higher limit and so defeat a restrictive-change notice. If
  limits no longer gate manual chits, there is nothing to defeat. It should shrink to the lift path,
  where the gate remains — or close entirely if the lift path is unaffected.
- **Lift capacity arithmetic assumes an in-band starting balance.** `LiftLading` computes free units
  up to `Target` capped by the receiver's `CreditLimit`; once the balance can start outside the limit
  band, that arithmetic needs to clamp rather than produce negative or nonsensical capacity. This is
  the first thing likely to break.
- **Reserved-balance interaction.** `WithinReservedCredit` couples direct chits to open pending
  lifts. Removing the direct-chit gate should not let a manual chit consume capacity a pledge has
  reserved in a way that breaks a lift already in flight.

## Open questions

- Whether the limits should still gate anything on the direct path, or become purely advisory there.
- Whether the counterparty should be able to express "I will not accept over-limit pledges" as
  policy, or whether declining to trade is a sufficient answer (we lean to the latter — it needs no
  mechanism).
- What this means for the credit gate's role as the system's one hard value-protecting constraint:
  after this change, what does the schema still guarantee about balances, and is that enough?
