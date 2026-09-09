# Scenario: Closing a tally

Source: [05-close-a-tally.md](../../../stories/mobile/05-close-a-tally.md)

The relationship has run its course. Winding it down needs nothing from the other party to *start* —
closing is the one act neither side can refuse, and the whole offer model leans on it: the protection
against an unwanted agreement is exit, not retraction.

## Step 1: What closing costs, before it happens

Nothing more builds up in either direction. What is owed does not go away, and closing does not
forgive it. The tally ends when the balance reaches zero — and settling stays allowed, because that
is the point.

The screen also says the other party cannot refuse, and keeps everything they are owed. Offering an
irreversible act as a bare button would have been the wrong shape.

![Before closing](../images/close-tally.png)

## Step 2: Closing, and waiting

Once asked, the tally shows what is still outstanding and says plainly what has narrowed: anything
moving the balance toward zero still goes through; anything moving it further from zero does not.
That rule lives in the data layer, not on this screen, so nothing can route around it — the paying
screen refuses an entry that would spend against a closing tally, and refuses one larger than what is
outstanding.

A closing tally can stay this way for a year. It is presented as **waiting on settlement, not broken
and not finished**. Where the parties agreed a date, it is shown; where that date has passed, it says
so — and says that nothing has been added to the balance for it. The app records; it does not
adjudicate.

![Closing, awaiting settlement](../images/close-tally-closing.png)

## Step 3: A remainder nobody would chase

Sometimes a close is held up by an amount plainly not worth anyone's time. The party **owed** it — and
only that party, since it is theirs to give up — is offered the write-off with the amount shown.
Taking it is one ordinary act of giving value, and it lands in the history like any other; there is no
special "forgive" operation, because there is no special act.

Declining leaves the tally exactly where it was, and the offer does not come back to nag.

Whether a remainder is trivial enough to offer this for comes from the engine, not from a threshold
the app invents: what counts as not worth chasing depends on the unit and on what the parties trade
in. Here it is two minutes of Dave's time.

![A remainder not worth chasing](../images/close-tally-writeoff.png)

## Alternates

**Nothing owed.** There is nothing to settle, so the tally closes right away.

**Changing your mind** (path E). While it is still closing, a party may withdraw their own request and
the tally carries on as it always was. Once the balance reaches zero it is final — carrying on means a
new tally.

**Both parties ask** (path F). Nothing changes; one request was already enough. Withdrawing works the
same way — the tally stays closing while either party's request stands.

**The counterparty is gone for good.** Everything stays readable — balance, history, terms, what they
disclosed. What cannot be done is *finish* it: a tally is a record kept together, so with their side
gone there may be nothing to add, including the settling that would close it. The screen says that
rather than looking live and quietly refusing everything.

## Not shown

A payment still in flight holding a close open (path D) — no fixture carries an unsettled routed
entry. Notifying the other party that a close was requested is notification work.
