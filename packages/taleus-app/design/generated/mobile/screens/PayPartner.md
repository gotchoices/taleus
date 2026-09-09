---
provides: ["screen:PayPartner"]
mocks: [tally, entries]
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
  - design/stories/mobile/20-pay-a-partner.md
  - design/generated/mobile/foundation.md
  - design/generated/mobile/screens/PayPartner.md
  - mock/data/tally.happy.json
  - mock/data/tally.error.json
  - mock/data/entries.happy.json
depHashes: {}
---

# Consolidation: PayPartner

Built from story 20 with no screen spec.

## Three decisions the story forced

**It needs nobody's agreement.** Step 4: recording value is the giver's own act, and the counterparty
does not agree to receive it. So there is no "send for approval", no pending state, no waiting-on-them
— the party signs and it is done. The screen says so, because the ordinary payment-app shape teaches
the opposite.

**The effect is shown before signing** (step 2): where the balance would stand, and what room would
be left of what the counterparty agreed to be owed. `previewEntry` derives this in the data layer
rather than in the screen, so the arithmetic happens once and in the same place in engine mode.

**The limit warns; it does not block** (path A). Going past what the counterparty agreed to be owed
is a pledge the party is entitled to make — refusing to let them make it protects nobody, since the
counterparty has given up nothing by holding it. The warning names how far past it goes and the
button stays live. Making the limit a wall would have been the natural reading of a "credit limit",
and it is the wrong one; `rules.md` § Credit already says limits warn rather than block.

## Which side of zero

Path F: a payment that crosses zero is not a different kind of act. `previewEntry` computes a signed
balance and reports the resulting perspective, so paying $200 into a tally that owes this party $180
simply lands at `$20 owed-by-me`. No branch in the screen, and no separate "settle up" flow.

## Not going through

Path D is the sharpest requirement in the story and the reason the write returns a `Result`: with the
counterparty wholly absent there is nowhere for the entry to land. It does not go through, the party
is told plainly, and **nothing is left half-done** — "did that go through" gets a straight answer.

`recordEntry` takes an `actId` the screen generates once per attempt, so retrying cannot record twice.
The engine will need to honour something equivalent — `docs/drafts/engine-api.md` question 4. The
story's own *Open* section says the reachability boundary is undecided; the user-visible rule holds
either way, and this screen only depends on the rule.

## What this closes

`TallyView` now offers its next actions (story 04 step 7). They were deliberately absent through five
slices because there was nowhere to send them.

## Not built here

Correcting a mistake (path C) is a further entry plus a request — the entry half works today, the
asking half is `CreateRequest`, and neither is wired as a "correct this" affordance. Paying with value
someone else owes (path B) is `PayThroughNetwork`. Warning the *receiving* party that a pledge exceeds
what they extended (path A step 4) belongs to `Attention`.

## Validation

`npx tsc --noEmit` clean; `npx jest` — eight tests over this arc, including that an unreachable
counterparty leaves the history unchanged and that the same `actId` records once.
