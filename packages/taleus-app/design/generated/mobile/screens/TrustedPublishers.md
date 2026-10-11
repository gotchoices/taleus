---
provides: ["screen:TrustedPublishers"]
mocks: []
dependsOn:
  - design/specs/project.md
  - design/specs/domain/interfaces.md
  - design/specs/mobile/navigation.md
  - design/specs/mobile/screens/index.md
  - design/specs/mobile/global/ui.md
  - design/specs/mobile/global/i18n.md
  - design/specs/mobile/global/toolchain.md
  - design/generated/mobile/foundation.md
  - design/stories/mobile/08-publishers-i-trust.md
  - design/stories/mobile/42-settings.md
  - design/generated/mobile/screens/TrustedPublishers.md
depHashes: {}
---

# Consolidation: TrustedPublishers

## What was built

| File | Role |
|------|------|
| `apps/mobile/src/screens/TrustedPublishers.tsx` | The screen |
| `apps/mobile/src/data/publishers.ts` | `listTrusted`, `trustPublisher`, `untrustPublisher`, `trustAgreement` |
| `taleus-model` `publishers` area | The list, kept in device state; sereus.org built in (`BUILT_IN_PUBLISHER`) |

`Settings` gained the row that opens it.

## Decisions

- **Kept for the party; this screen is optional.** Story 08 step 5: the list grows as the party decides
  on agreements (`ReviewInvitation`'s trust choice, `CreateInvitation`'s import), so the intro and
  footnote say nobody has to come here.
- **sereus.org first, fixed.** No remove action; the model refuses to remove it.
- **Removing confirms in-screen** and says what it does not do: tallies already agreed are unchanged
  (path E). Navigation's rule that nothing binding is a side effect of a tap.
- **Adding by name** is validated by the model (Stroc's `isDomain`); the error is shown in place.

## Not built here

Why a publisher was added (story 08 step 5 mentions it); only when.
