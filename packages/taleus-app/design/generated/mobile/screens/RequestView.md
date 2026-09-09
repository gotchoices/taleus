---
provides: ["screen:RequestView"]
mocks: [requests, tally]
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
  - design/stories/mobile/21-ask-to-be-paid.md
  - design/stories/mobile/22-respond-to-a-request.md
  - design/generated/mobile/foundation.md
  - design/generated/mobile/screens/RequestView.md
  - mock/data/requests.happy.json
  - mock/data/tally.happy.json
depHashes: {}
---

# Consolidation: RequestView

Built from stories 21 and 22 with no screen spec.

## A contradiction between the stories, resolved before building

Story 22 step 1 had the payer seeing "when the request runs out", and its first acceptance criterion
said "when the request expires". Story 21 says the opposite, twice and emphatically: a request is not
set ticking, it stands until answered or withdrawn, and an unpaid bill does not stop existing because
a month went by. Story 22's own path D and a later criterion agree with 21 — "keeps waiting and
visibly ages; it does not lapse on its own".

So 22 contradicted itself and 21. Story 21 governs, and story 22's two lines were corrected to *how
long it has been waiting*. Building to the unfixed story would have put an expiry on the screen and
made the app disagree with itself.

## Decisions

- **The amount is the requester's** (story 22 step 3). Paying hands the figure to `PayPartner` rather
  than opening an empty field — the payer is *answering*, not deciding an amount. `PayPartner` gained
  an optional `amount` prefill and an `answers` id for exactly this.
- **Paying part is its own act**, offered beside paying in full, because a request may be answered in
  full, in part, or not at all — and the payer says which. It opens `PayPartner` *without* a prefill,
  since the part is the payer's figure, not the requester's.
- **Nothing pretends a part settled the whole.** `applyToRequest` accumulates what was applied and
  recomputes what is still asked; an entry carrying `answers` records against the request as it goes
  in, so the tie is made where the value moves rather than by a later reconciliation.
- **The two sides of a request are different screens' worth of choices**, on one screen: the party
  who asked can take it back; the party asked can pay, part-pay or decline. Neither is offered the
  other's actions.
- **Declining takes an optional reason** and says it costs nothing and moves nothing (path A) —
  neither party is left with a refused request nagging or an answer that never comes.
- **Path E is served by a link, not a dossier.** "Who is asking" names the tally and offers the
  history, which is what tells a forgotten obligation from a mistake.

## What this closes

The paying arc is complete: a request can be made, followed, answered in full or in part, declined,
or withdrawn, and an entry that answers one is tied to it.

## Not built here

An attention item names `RequestView` but carries a tally id, not a request id, so it still lands on
the tally where the request is listed. Closing that needs the attention fixture to name the request —
an engine-contract question rather than a screen one.

Seeing requests across all tallies together (path F) is `Attention`'s, and exists. Requesting more
room rather than paying past the limit (path C) is story 03 path C, unsliced.

## Validation

`npx tsc --noEmit` clean; `npx jest` — seven tests, including that no expiry appears anywhere on the
screen and that paying in full hands over exactly what is still asked.
