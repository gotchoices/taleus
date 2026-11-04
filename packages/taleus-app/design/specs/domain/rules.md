# Rules

App-facing rules of play. Engine semantics live in `docs/architecture.md`; this file states only
what the apps must get right.

## Amounts

Each tally is denominated in one unit, fixed for its life. A party holds tallies in different units,
and no unit is privileged — there is no single party-level balance.

A party may pick a display unit. Cross-unit figures are estimates at the party's own rates, shown as
estimates, never replacing the per-unit figures. One set of rates serves both trading and display;
where a rate runs both ways, an estimate takes the less favourable direction. An estimate states what
it covers and names any holding it left out for want of a rate.

Value does not move between units a party has not priced. Until they say what one unit is worth to
them, their tallies in different units settle separately — nobody else's valuation is applied to
their holdings on their behalf.

Pricing a unit others trade widely is a market position, not a display choice: the party's rate is
what value converts at until they change it, against counterparties who may follow that market far
more closely. Treat it as a decision with exposure, and say so.

## Credit

Two limits per tally, one per direction, each set by the party being asked to trust. They need not
match and either may be zero. Zero credit is not a closed tally.

A limit says what a party agreed to be owed. It does not stop the other party pledging more: a
pledge is the pledger's own promise, and the party holding it has given up nothing. Both sides are
warned when a pledge goes beyond the limit — the one making it, and the one deciding whether to
hand over goods for it. Lifts are governed by each party's lift settings (trading variables), not by
the limits. A close request is irreversible: the tally winds down, accepting chits either way but
lifts only toward zero (a chit that grows the balance is recorded, with a warning), and once it
reaches zero it is closed for good — nothing more is recorded.

## Agreements

Every tally is governed by an agreement both parties accept — chosen when the tally is offered, from
agreements someone has published and stands behind. Terms (limits, notice) are arguments to it. A
party can read it before accepting and can refuse it.

Notice is offered at 30 days wherever a party sets it, inviting or accepting: the customary term for
credit between people who trade. Either party changes it before agreeing.

## Requests

A request for payment is not an offer and does not behave like one.

- It commits nobody. Until the payer gives value, the amount asked is a statement of what the
  requester wants.
- It does not expire. It stands until answered or withdrawn, and both parties can see how long it has
  been outstanding.
- The requester may withdraw it at any time; the payer sees it withdrawn.
- The payer may answer in full, in part, or not at all, and may answer several requests with one
  payment.
- A part-answered request shows what was applied and what is still asked for.

## Signing

Two kinds of act, and the app has to keep them apart:

- **The party signs it, then and there.** Terms, offers and acceptances, manual payments,
  disclosures, close requests, corrections, and changes to the party's own lift settings. Nothing of
  this kind happens on a party's behalf or as a side effect of something else.
- **The party authorized it earlier.** Lifts. A party's signed lift settings say how much movement it
  will accept and at what price; lifts then happen within those settings without prompting, including
  while the party is asleep.

So the app never asks a party to approve a lift, and never fails to ask before anything else. What a
party's settings currently permit is something they can see and change; changing them is itself an
act they sign.

## Delivery

A party's own act is saved on their device first and reaches the counterparty afterwards (story 15;
the mechanics are Sereus's: `../sereus/docs/strands.md`, "Offline mode" and "A commit's
durability"). Each of the party's own acts carries one of these states, which the app shows and
never computes:

| State | Shown as |
|---|---|
| waiting | "Waiting to send"; with "May not go through" when the counterparty can still make it fail |
| sending | "Sending" |
| here-only | "Not yet with {name}" |
| unconfirmed | "Not confirmed delivered", never "stuck" |
| delivered | nothing: the normal case |
| not-recorded | leaves the record; listed with its reason until the party has seen it |

- States only move forward.
- The counterparty's acts carry no state; they appear when they arrive.
- An amount that the counterparty does not hold yet is stated on its own, as movement ("$70.00 you
  gave is not yet with Mara"), never as a part of the balance owed.
- The receiver of value acts on their own side's record, never on the giver's screen. The app says
  so where it matters (the giver's confirmation).
- A date is its signer's. The counterparty's entry dated ahead of this device's clock is recorded
  and marked, not refused.

## Offers

- An offer is not an agreement until both parties sign it.
- More than one offer may be outstanding; any unexpired one may be accepted.
- If two end up signed by both parties, the later-drafted one governs.
- Offers expire, and can also be refused outright. A refusal reaches the offerer; being ignored
  only tells them time ran out.
- A refused offer is finished and cannot be revived. A fresh offer can always be made.
- Exit is by close, not by retraction.
