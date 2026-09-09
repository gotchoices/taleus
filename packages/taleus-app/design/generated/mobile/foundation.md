---
provides: ["foundation:mobile"]
dependsOn:
  - design/specs/project.md
  - design/specs/domain/amounts.md
  - design/specs/domain/interfaces.md
  - design/specs/mobile/navigation.md
  - design/specs/mobile/components/index.md
  - design/specs/mobile/global/ui.md
  - design/specs/mobile/global/i18n.md
  - design/specs/mobile/global/toolchain.md
---

# Consolidation: shared foundation

Appeus consolidations are per screen, and most code belongs to one. This layer does not: it is what
every screen sits on, and it was accumulating without a record. Screen consolidations `dependsOn`
this file, so changing the foundation marks all of them stale — which is the right answer, because
it is exactly the code twenty-five more screens will inherit.

## What is here

| File | Role | Spec |
|------|------|------|
| `src/theme/tokens.ts` | semantic colour, spacing, type scale | `global/ui.md` |
| `src/theme/index.tsx` | `ThemeProvider`, `useTokens`, `useStyles` | `global/ui.md` § theme is selectable |
| `src/i18n/index.ts` | `t()`, `getLocale`, plurals by `Intl.PluralRules` | `global/i18n.md` |
| `src/i18n/locales/en.json` | the only bundled locale | `global/i18n.md` |
| `src/hooks/useLoad.ts` | the load state machine, once | — |
| `src/util/amount.ts` | an amount decomposed for display | `domain/amounts.md` |
| `src/util/date.ts` | civil dates in UTC, instants locally | `domain/interfaces.md` § Dates and instants |
| `src/components/Amount.tsx` | the figure: unit, sign, fraction, colour, spoken form | `domain/amounts.md` |
| `src/components/ChitMark.tsx` | the CHIP glyph, drawn | `domain/amounts.md` § The chit mark |
| `src/components/Card.tsx` | `Card`, `Row`, `OpenableRow`, `Action` | `components/index.md` |
| `src/components/Chip.tsx` | state and waiting-on chips | `components/index.md` |
| `src/components/Screen.tsx` | `Loading`, `Failed`, `Empty` | `components/index.md` |
| `src/components/ErrorBoundary.tsx` | says what failed instead of going blank | `components/index.md` |
| `src/components/Options.tsx` | a set of choices, one or several at a time | story 42 |
| `src/components/Segmented.tsx` | one choice from a few, in a row rather than a column | story 43 |
| `src/components/Input.tsx` | a labelled text field | — |
| `src/components/index.ts` | the barrel every screen imports from | — |
| `src/navigation/routes.ts` | route names, params, tab set, screen prop types | `navigation.md` |
| `src/navigation/linking.ts` | deep links and universal links | `navigation.md` § Deep Links |
| `src/navigation/index.tsx` | tabs over four native stacks | `navigation.md` |
| `src/data/config.ts` | the one mock/engine switch | `interfaces.md` § Run modes |
| `src/data/types.ts` | app-side shapes mirroring the domain contract | `interfaces.md` |
| `src/data/party.ts` | who this party is; the first adapter that writes | `interfaces.md` |
| `src/data/settings.ts` | the party's preferences, and which follow them | story 42 |
| `src/hooks/usePreferences.ts` | stored preferences applied before the first paint | story 42 |
| `src/util/fields.ts` | the field vocabulary both disclosure directions read | story 11 |
| `src/session/index.tsx` | whether a party exists — the root state the navigator gates on | story 10 |
| `src/mock/variant.ts` | variant from a deep link; screens never see it | `appeus/reference/mock-variants.md` |
| `App.tsx`, `index.js` | providers, error boundary, entry point | — |
| `testUtils.tsx` | `renderScreen`, typed navigation stubs for tests | — |

## Decisions worth not re-litigating

- **One load hook.** Five screens each had a copy, and three dropped `result.error` — losing the
  message and the adapter's word on whether retrying could help. `useLoad` owns it.
- **Theme is context, not `useColorScheme()` per screen.** `global/ui.md` makes the theme selectable
  (system | light | dark), which a per-screen call cannot express. The settings slice (42) has
  somewhere to write.
- **Styles are built per token set, not per render.** `useStyles(factory)` memoises; `TallyRow` was
  calling `StyleSheet.create` once per row.
- **Amounts go through one component.** Colour, sign, the fraction notation, the estimate mark and
  the spoken form are decided once. Three screens previously coloured figures by three different
  rules, with colour as the only cue.
- **Launch parameters are applied before any data is read.** `?variant=` decides which fixtures
  answer, and React Navigation supplies the initial URL only after its container mounts — too late
  for anything read at startup. `applyLaunchParams()` runs at the head of the session's load.
- **A preference is applied where it is read, and stored beside it.** The i18n bundle owns the
  locale, `util/amount.ts` owns mark-or-code, the theme provider owns the appearance. `usePreferences`
  reads them once at startup and hands each to its owner, because a party who set them on another
  device has never opened the settings screen on this one. It gates the first paint: a party who chose
  "always dark" must not be shown a light app for a frame and then corrected.
- **A repeated choice goes in a row, not a column.** `Options` is right when each choice needs a
  sentence. When the same three-way choice repeats down a screen, a column turns a small table into
  four screens of scrolling and costs the reader the comparison the table was for — `Segmented` is
  for that case, and only that case.
- **State updates are functional, not built from a render-time copy.** A tick and a keystroke can land
  in one batch, and two updates each built from the same copy silently undo one another. This was a
  real defect in the disclosure screen before the tests found it.
- **An error boundary, because release builds are silent.** A render error shows a blank screen with
  nothing in logcat. That cost two debugging sessions before the boundary existed.

## Known rough edges

- `react/no-unstable-nested-components` warns on the tab bar's `tabBarIcon` render prop — that is the
  library's documented API, and the warning is noise.
- The app's `no-void` warnings conflict with the repo's own rule (`AGENTS.md`: prefix unused promise
  calls with `void`). The repo rule wins; the React Native eslint preset disagrees.
- Cold start is ~20s to first paint after a fresh install on the reference AVD, ~13s warm. It is not
  a defect but it does invalidate any screenshot taken sooner.
