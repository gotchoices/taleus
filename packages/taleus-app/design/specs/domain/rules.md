# Rules

Invariants the apps must respect, beyond what the schema enforces.

## Units of account

Each tally is denominated in exactly one unit, fixed for its life. A party holds tallies in
different units at the same time, and no unit is privileged.

A party may choose a **display unit**. Any figure spanning tallies of different units — a portfolio
total, a net position — is an **estimate** converted at the party's own exchange-rate quotes, and is
shown as an estimate. It is never authoritative and never the only figure offered: per-unit totals,
in each tally's own unit, are always available alongside it.

The quotes are the party's own private trading policy, directional and carrying its own spread. An
estimate is therefore *this party's valuation*, not a market price, and two parties may value the
same holdings differently. Both are correct.

## Credit

Credit is granted per tally, per direction. Each party unilaterally decides how much it is willing
to be owed by the other and how much notice it requires to call the balance — its own decision,
signed by it alone. A tally therefore carries two independent limits, which need not be equal, and
either may be zero.

Zero credit is not a closed tally.

## Offers and acceptance

An offer is not an agreement. It becomes one only when both parties have signed the same offer.

- Offers are uniquely identified. More than one may be outstanding at a time.
- Any outstanding, unexpired offer may be accepted, **including one that a newer offer was meant to
  replace**. In a distributed system a signature can be in flight while a revision is being sent;
  the acceptance stands. Sending a second offer is a suggestion, not a retraction.
- An offer that has expired can no longer be accepted. Expiry is the only thing that ends an offer.
- Declining is private: the declining party clears the offer from its own view, and the other party
  learns nothing. Silence and refusal are indistinguishable, deliberately.

The protection against an unwanted agreement is not retraction but exit: either party may request
close at any time, and close cannot be refused once the balance is settled.

Terms may be renegotiated at any time by the same mechanism — a later offer, signed by both, amends
the tally. The unit of account is the one term that never changes.
