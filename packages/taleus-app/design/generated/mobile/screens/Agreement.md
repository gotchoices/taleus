---
provides: ["screen:Agreement"]
mocks: [terms]
dependsOn:
  - design/specs/project.md
  - design/specs/domain/interfaces.md
  - design/specs/mobile/navigation.md
  - design/specs/mobile/screens/index.md
  - design/specs/mobile/global/ui.md
  - design/specs/mobile/global/i18n.md
  - design/specs/mobile/global/toolchain.md
  - design/generated/mobile/foundation.md
  - design/stories/mobile/01-invite-a-partner.md
  - design/stories/mobile/02-respond-to-an-invitation.md
  - design/stories/mobile/07-review-the-agreement.md
  - design/stories/mobile/08-publishers-i-trust.md
  - design/generated/mobile/screens/Agreement.md
depHashes: {}
---

# Consolidation: Agreement

## What was built

| File | Role |
|------|------|
| `apps/mobile/src/screens/Agreement.tsx` | The screen: an agreement read in full |
| `apps/mobile/src/components/PublisherNote.tsx` | Who stands behind an agreement, said the same way everywhere (foundation) |
| `apps/mobile/src/data/tally.ts` | `readAgreement(agreementId, tallyId?)` |
| `mock/data/terms.{happy,error}.json` | The mock document, now in numbered sections |

Reached from `TallyTerms` (with the tally), `ReviewOffer` (with the tally), `ReviewInvitation` and
`CreateInvitation` (without one). Deep link `taleus://screen/Agreement/<agreementId>/<tallyId?>`.

## Decisions

- **Who stands behind it comes first.** Story 08: few parties judge an agreement by reading it, so the
  title is followed by `PublisherNote` before any text.
- **Rendered natively from the model's structure.** `AgreementDocument.sections` is a tree — number,
  title, a paragraph of styled runs, children, and `included` where a section is another published
  document. Runs nest inside one `Text` so a paragraph wraps as a block; references and filled-in
  figures are marked in the accent colour. No web view.
- **A tally's agreement is read from the tally** (story 07 step 5): `tallyId` goes to
  `readAgreement`, which reads the strand's `Document` table first. With a tally, the parameters the
  terms fill in are named under the title.
- **Unreadable is a screen of its own.** The model returns a failure when any part is missing or a copy
  does not match its CID; the screen says it cannot be read in full and offers a retry. Agreeing to it
  is blocked where agreeing happens (`ReviewInvitation`, `ReviewOffer`), not here.
- **The exact-text line.** The footer names the CID and says one changed word would be a different
  agreement — the honest form of "you have read this before", which story 02 dropped.

## Not built here

Printing or exporting as PDF (`@stroc/pdf`). Fonts for right-to-left or CJK scripts.
