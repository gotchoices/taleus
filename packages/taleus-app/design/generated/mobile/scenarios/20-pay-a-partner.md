# Scenario: Paying a partner

Source: [20-pay-a-partner.md](../../../stories/mobile/20-pay-a-partner.md)

Sam buys a tube from Mara, and separately settles the bike with Jan. Recording value is always the
giver's act.

## Step 1: What is being given, and what it is for

An amount and a note — enough that either of them will recognise it in a year. Nothing here asks the
counterparty for anything: this is Sam's own act, and Mara does not agree to receive value.

![Record value given](../images/pay-partner.png)

## Step 2: Before you sign

Typing an amount shows what it would do: where the balance would stand afterward, and what room would
be left of what Mara agreed to be owed. The tally with Mara owes her $42.50 with $157.50 of room, so
a $40 tube leaves $117.50 of room and $82.50 owed.

Crossing zero is not a different kind of act (path F). Paying $200 into Jan's tally, which owes Sam
$180, simply lands at $20 owed the other way — arithmetic, not a separate "settle up" flow.

*These states follow from what is typed, so they have no link of their own.*

## Step 3: Past the limit — warned, not blocked

Asking for $200 on Mara's tally goes $42.50 beyond what she agreed to be owed. The screen says how
far past, and that she is under no obligation to treat it as payment — and the button stays live.

A pledge is Sam's own promise to pay. Refusing to let him make it protects nobody: Mara has given up
nothing by holding it. The limit says what Mara agreed to; it does not say what Sam can promise.

## Step 4: Signed

Both parties see the same entry. Nothing can be edited or removed — a correction is a further entry,
and both stay visible. A ledger shows what happened, including the parts nobody is proud of.

## Alternate: it does not go through

With nothing of the counterparty's reachable, the entry has nowhere to land. It does not go through,
and Sam is told so plainly: standing at a counter, "did that go through" is the only question he has.
Nothing is left half-done, and trying again cannot record it twice — each attempt carries one id.

## Not shown

Correcting a mistake (path C) is a further entry plus a request; both halves exist but nothing wires
them together as "correct this". Paying with value someone else owes (path B) is
`PayThroughNetwork`. Warning the *receiving* party that a pledge exceeds what they extended belongs
to `Attention`.
