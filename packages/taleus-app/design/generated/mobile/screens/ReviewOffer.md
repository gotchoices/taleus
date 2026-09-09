---
provides: ["screen:ReviewOffer"]
mocks: [offer]
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
  - design/stories/mobile/03-negotiate-terms.md
  - design/generated/mobile/foundation.md
  - design/generated/mobile/screens/ReviewOffer.md
  - mock/data/offer.happy.json
  - mock/data/offer.empty.json
  - mock/data/offer.superseded.json
depHashes: {}
---

# Consolidation: ReviewOffer

Built from story 03 with no screen spec, against `docs/architecture.md` § Offer semantics.

## The two decisions that shaped the screen

**A counter is a new offer, not an edit.** The acceptance criterion says countering is "presented as
replacing agreement, not as editing a live agreement", and the architecture explains why it has to
be: a proposal is identified, ordered and carries an expiry, and more than one may be outstanding at
once. So the counter is its own section *below* accepting, saying in words that this becomes a new
offer the other party must agree to. The natural design — editable fields on the terms themselves,
with one Save — would have said the opposite: that terms are a mutable thing one party adjusts.

**What changed comes first.** Step 3 is Jan seeing exactly what Sam changed: the notice period,
nothing else. A screen showing only the new terms would make the reader diff two offers in their
head, which is precisely the work the story is removing.

## Other decisions

- **Terms in force and terms proposed are separated by the data, not by wording.** `inForce` is null
  while a tally is forming, and the footnote changes accordingly: either "the tally keeps working on
  these while the offer is pending" (path C — nothing is in limbo) or "this tally does not exist
  until you both sign the same offer". The two situations look different because they are.
- **The unit is stated as not negotiable**, which is the story's last acceptance criterion and the
  schema's `DenominationImmutable`. It is shown, never offered.
- **Counter fields are empty with the current value as placeholder.** Typing nothing means proposing
  nothing changed, which is what an empty field should mean.

## Path A — two offers signed at once

Its own fixture variant and its own rendering, because the story is emphatic that neither party is
left believing something different is in force. Both offers are named with their drafting dates, the
later one marked as governing, and the screen says either may propose again or close the tally —
nobody is trapped by the outcome.

Precedence follows the proposal's own version ordering, not the order signatures arrived. The app
only displays what the engine decides; it must never compute this from timestamps it happens to hold.

## What this closes

`Attention`'s offer item names `ReviewOffer` and has been falling back to `TallyView` since that
screen was built. `isTallyRoute` now includes it, so the item reaches what it names.
`ReviewInvitation` no longer says countering is unbuilt.

## Not built here

Paths C, D and E are about a tally that is already open: asking for terms only the other party can
grant, changing one's own limit unilaterally, and calling a balance in with a deadline from the
agreed notice. All three are `TallyTerms` / `TradingSettings` / `CloseTally`, unsliced. Path B, an
offer going stale, needs an expiry the app can watch rather than a fixture timestamp.

## Validation

`npx tsc --noEmit` clean; `npx jest` — eight tests, including that the superseded case names both
offers and that an attention item naming `ReviewOffer` now routes there.
