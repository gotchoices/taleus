---
provides: ["screen:Settings"]
mocks: [settings]
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
  - design/generated/mobile/foundation.md
  - design/stories/mobile/42-settings.md
  - design/generated/mobile/screens/Settings.md
depHashes: {}
---

# Consolidation: Settings

## What was built

| File | Role |
|------|------|
| `apps/mobile/src/screens/Settings.tsx` | The screen |
| `apps/mobile/src/data/settings.ts` | `readSettings`/`writeSettings`, and which choices follow the party |
| `apps/mobile/src/hooks/usePreferences.ts` | Stored preferences, applied before the first paint |
| `apps/mobile/src/components/Options.tsx` | A set of choices, one or several at a time |
| `mock/data/settings.happy.json` | Locale, display unit, unit style, appearance, units held |

This slice also opens the **SETTINGS tab** (`navigation.md` § Sitemap), the fourth and last tab, and
makes three preferences already built into the foundation reachable for the first time: the theme
choice `ThemeProvider` has always supported, the locale `i18n` has always accepted, and the
mark-or-code choice `amounts.md` calls the reader's.

## Decisions

- **Grouped by what follows the party, not by subject.** Story 42 step 6 asks for exactly this, and a
  party setting up a second phone needs the answer before they start rather than after. `followsParty`
  and `belongsToDevice` in the adapter are the same statement in code, so a preference added later
  cannot quietly land in the wrong group.
- **Mark or code shows both forms at once.** The choice is about what a figure looks like, so each row
  renders the figure — `$180 50/` against `USD 180 50/`. `Amount` gained a `unitStyle` override for
  this one screen; everywhere else it reads the party's stored choice.
- **The language note says what language does not reach.** Steps 2 and 3: what a counterparty wrote
  stays in their words, and a tally's agreement stays in the language it was signed in. Both sit under
  the language chooser, where somebody switching languages will actually read them.
- **A display unit with no rate is allowed, and explained.** Path B: the party is told their overall
  figures cannot be estimated in it and pointed at rates. Refusing the choice would be the app
  deciding what they may think in.
- **What is not a preference is named, with where it lives.** Path C. A party who comes to settings
  looking for what they let a partner owe must find the answer, not a gap — so the card states that
  it is a term of that tally, and that how value moves is a signed permission.

## Not built here

Exchange rates (story 41) — the screen path B points at. It is named in prose rather than linked,
because a dead row is worse than a sentence. Notifications (43), devices (13), the cadre (14),
recovery (12) and the standing invitation (01 path C) are the tab's other rows, and none exist yet.
Story 42's `empty` and `error` variants have no fixture: `empty` is these defaults unchanged, and
both error states are reached by interaction rather than by a different world.

## Validation

- `npx tsc --noEmit` clean; `npx jest` 102 tests in 13 suites; `npm run lint` no errors.
- Seven tests in `__tests__/settings.test.tsx`, one per acceptance criterion that is this screen's.
- Captured on `emulator-5566`.
