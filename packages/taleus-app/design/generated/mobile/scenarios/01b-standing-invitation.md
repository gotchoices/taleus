# Scenario: A code others can take up

Sources: [01-invite-a-partner.md](../../../stories/mobile/01-invite-a-partner.md) path C,
[10-first-run.md](../../../stories/mobile/10-first-run.md) path E,
[11-my-profile-and-disclosure.md](../../../stories/mobile/11-my-profile-and-disclosure.md) path C,
[21-ask-to-be-paid.md](../../../stories/mobile/21-ask-to-be-paid.md) path A

An ordinary invitation waits for one answer. This waits for any number, and every difference on the
screen follows from that.

## Step 1: Nobody can look you up

There is no directory and there is not going to be one. A party is findable only if they hand
something out — printed by the till, on a card, in a message. Said on the screen, because a party who
expects to be findable will otherwise wait to be found.

And it can be published before they have ever tallied with anybody.

![Published](../images/standing-published.png)

## Step 2: One set of terms, offered to whoever turns up

What the party will let a *stranger* owe them. Nothing is the ordinary answer and it still works:
whoever takes it up hands over value, it is recorded, and they spend it from there — which may be
worth a better price, since they have in effect lent the money up front. Story 21 path A, and the
screen presents it as a working offer rather than a grudging one.

The rest binds only the publisher, exactly as on a one-to-one invitation: whether anyone extends
anything back is theirs to decide, tally by tally.

## Step 3: What everyone who takes it up learns about you

Story 11 path C, and the reason this is not the invitation form with the expiry removed. Whatever
goes in here goes to every person who takes it up — people the party has not met and will not meet
before they do.

## Step 4: A party who has none yet

The warning sits *above* the picker, before anything is chosen, and nothing is pre-selected.
Publishing waits on the party saying they understand it goes to everyone. Afterwards would be too
late for the only decision that mattered.

![None yet](../images/standing-none.png)

## Step 5: Who took it up

Each is a separate tally from the moment it opened, and none of them is bound to what was published —
any of them can be negotiated on its own afterwards. Each row opens its own tally.

## Step 6: Withdrawing

Stops new people taking it up, and does nothing to the tallies that already came from it. Those
stopped being this invitation's business when they opened.

## Not shown

Copying to the clipboard, sharing to another app, and rendering the code for print: the screen shows
the link and marks it copied. `CreateInvitation` has the same gap. The link itself reaches a card as
`inv%3A…` because a token carries a colon — an identifier question for the engine, not something a
screen should paper over.
