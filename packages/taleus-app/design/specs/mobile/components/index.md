# Components Plan

Shared building blocks. Specs stay user-observable — what a component guarantees, not how it is
written; implementation mapping lives in `design/generated/mobile/screens/*.md`.

## Components

| Component Name | Spec File | Used By | Status |
|----------------|-----------|---------|--------|
| Amount | amount.md | TallyList, TallyView, TallyHistory, Attention, Position | built |
| Chip | chip.md | TallyList, TallyView, TallyHistory, Attention | built |
| Card / Row | card.md | TallyView, Position | built |
| Openable row | card.md | TallyList, Attention | built |
| Action | card.md | every screen with a next step | built |
| Loading / Failed / Empty | screen-states.md | every data-backed screen | built |

## Amount

Wherever a figure appears. Guarantees, in one place, what every screen would otherwise re-decide:

- The figure always carries its unit. A bare number is never shown.
- A figure with a **side** shows it three ways — the word, a sign, and colour — so no reader depends
  on colour ([`global/ui.md`](../global/ui.md)). Zero has no side and takes none of the three.
- A figure **converted** into the display unit is marked as an estimate and cannot be mistaken for a
  signed balance.
- Screen readers hear the direction, not just the number.

## Chip

A state worth finding on a long list: *needs you*, `Offered`, `Closing`. Filled when it is a demand
on this party, plain when it is merely a fact. Story 06 path A is the reason it exists.

## Card / Row / Openable row / Action

The card vocabulary the screens share: a titled block, a label-and-value line, a line that opens
something (and wears a chevron because it does), and a primary action. Anything tappable meets the
platform touch minimum and shows a pressed state; anything that is not tappable wears neither.

## Loading / Failed / Empty

The three states every data-backed screen has. `Failed` shows what the data layer actually said and
offers to try again only when the data layer said trying again could help. `Loading` waits a moment
before painting a spinner, so a fixture that resolves in a tick does not flash.

## Notes

- Component spec filenames use kebab-case; the ones above are described here until any needs a page
  of its own.
