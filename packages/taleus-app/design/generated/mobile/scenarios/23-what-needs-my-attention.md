# Scenario: What needs my attention

Source: [23-what-needs-my-attention.md](../../../stories/mobile/23-what-needs-my-attention.md)

Everything waiting on this party, across every tally, so nothing has to be hunted for.

## Step 1: What is waiting, and for how long

Each item says who it involves, what it is, what it would cost, and how long it has waited. Items are
reachable — the point of the list is getting to the thing, not naming it.

Two absences are deliberate. Automated settling never appears: it was authorized in advance and needs
nothing. And items waiting on the *other* party appear plainly marked, so a party knows about them
without being asked for anything.

![Attention](../images/attention-happy.png)

## Step 2: Nothing waiting

A good state, and it reads like one rather than like a failure to load.

![Nothing waiting](../images/attention-empty.png)

## Not shown

Setting an item aside and bringing it back, deadlines distinguishable without date arithmetic, and
the record of what became of past items (paths E and F) are unsliced — `AttentionHistory` does not
exist. The fixture is three items; the story's error variant is eleven after a week away.
