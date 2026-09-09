---
provides: ["screen:CloseTally"]
mocks: [tally]
dependsOn:
  - design/specs/project.md
  - design/specs/domain/interfaces.md
  - design/specs/domain/rules.md
  - design/specs/domain/amounts.md
  - design/specs/mobile/navigation.md
  - design/specs/mobile/screens/index.md
  - design/specs/mobile/global/ui.md
  - design/specs/mobile/global/i18n.md
  - design/specs/mobile/global/toolchain.md
  - design/stories/mobile/05-close-a-tally.md
  - design/generated/mobile/foundation.md
  - design/generated/mobile/screens/CloseTally.md
  - mock/data/tally.happy.json
  - mock/data/tally.closing.json
  - mock/data/tally.error.json
depHashes: {}
---

# Consolidation: CloseTally

Built from story 05 with no screen spec.

## Decisions

**Consequences before the act.** Closing is the one thing a party can always do and the other cannot
refuse — `architecture.md` calls exit the protection against an unwanted agreement. A screen offering
that as a bare button would be wrong, so the first thing it says is what closing costs: nothing more
builds up, what is owed does not go away, the tally ends at zero. Settling remains allowed, because
that is the point.

**Closing narrows direction, and the data layer enforces it.** `recordEntry` refuses an entry that
would move the balance further from zero, or past it, on a closing tally — the rule lives with the
write rather than in a screen, so no future screen can route around it. Two distinct refusals, since
"you cannot spend here now" and "that is more than is outstanding" are different mistakes.

**Waiting, not broken** (path C). A closing tally with a balance can stay that way for a year. The
screen says it is awaiting settlement, names any date the parties agreed, and — if that date has
passed — says so while stating that nothing has been added to the balance for it. The app records; it
does not adjudicate.

**Nothing is written off automatically, and the threshold is not ours.** A remainder is forgiven by a
deliberate act with an author, and only by the party it belongs to. Whether a remainder is trivial
enough to *offer* that for comes from the engine as `closing.offerWriteOff`; the app must not invent
a threshold, because what counts as not worth chasing depends on the unit and on what the parties
trade in. Declining leaves the tally exactly as it was and the offer does not return, which the
story asks for in as many words.

**A write-off is an ordinary payment.** Handing the balance back routes to `PayPartner` like any
other value given, and lands in the history like any other entry. There is no special "forgive"
operation, because there is no special act.

**Both requests, one close** (path F). A second request changes nothing; withdrawing while the other
party's request stands leaves it closing. `requestClose` and `withdrawClose` move between
`me`/`them`/`both` rather than treating the flag as a boolean.

## Not built here

Path D — something in flight holding a close open — needs an unsettled routed entry, which no fixture
carries. Notifying the other party (step 3) is notification work. Story 05's *Open* section leaves the
reachability boundary undecided; this screen shows the unworkable case when the counterparty is
unreachable and does not attempt to predict when a write would succeed.

## Validation

`npx tsc --noEmit` clean; `npx jest` — nine tests, including that a closing tally refuses an overshoot,
that withdrawing the only request reopens it while withdrawing one of two does not, and that declining
the write-off does not bring it back.
