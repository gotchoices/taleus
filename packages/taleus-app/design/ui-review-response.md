# Response to `ui-review.md`

Written against the review of the first five screens. Everything graded **must** in § 1, § 2, and
§ 3 was adopted, plus the § 4 foundation work. What follows is only the parts where the answer was
something other than "yes, fixed" — deferrals, and the two places I disagreed.

## Disagreed

**"Dates render a day early" — half right, and the fix is not the formatter.**

`2026-03-02T00:00:00Z` rendering as "Mar 1" is a real defect. `2026-08-21T03:11Z` rendering as
"Aug 20" is *correct*: that one is an instant — the moment an entry was signed — and it belongs in
the reader's own zone. Formatting both the same way is the bug, not the direction of the shift.

So the fix is a distinction rather than a `timeZone` option: `interfaces.md` § Dates and instants now
says which of the two the engine is handing over, `types.ts` carries `CivilDate` and `Instant`,
`formatCivilDate` reads days in UTC, and `formatInstant` reads moments locally. Terms dates were the
only civil dates in the fixtures; they now look like dates (`2026-03-02`, no clock) so the mistake
cannot be made silently again.

This is also a question for Nate — see `docs/drafts/engine-api.md`. If the engine returns everything
as a timestamp, the app has to be told which ones are days.

**"`TallyView` offers no next action" — real gap, wrong remedy.**

The story's acceptance criterion is right and the screen does not meet it. But Pay, Request, and
Terms are unsliced, and buttons that route nowhere (or to a stub) are worse than their absence: they
teach a reviewer that the app does more than it does, and they are the first thing to rot. Recorded
in the `TallyView` consolidation under what was not built, to be closed by the Pay/Request/Terms
slices rather than papered over now.

## Deferred, with a reason

| Item | Why not now |
|------|-------------|
| Tab-bar icons | Needs a native icon package that has to be checked against RN 0.82 — the check `react-native-screens` failed. `debt-mobile-icon-set`. Text glyphs cover the chevron and the direction of an amount in the meantime. |
| i18next, device locale, namespaced plurals | The local `t()` now does namespaced keys and `Intl.PluralRules`, which is what the spec actually required. The library itself earns its place at the settings/language slice. `debt-mobile-i18n-library`. |
| React Navigation | Unchanged: `debt-mobile-navigation-library`. Hardware back and replace-if-same-route are now handled by the local navigator, which was the urgent part. |
| Pull-to-refresh, `ListEmptyComponent` under a filter | Both belong to the story-06 sort/search work, which is unsliced. |
| Progressive disclosure of captions | Agreed, and agreed not yet. `Card` has the footnote slot it would hang off. |
| `navigation/linking.ts`, `navigation/types.ts` split | Cosmetic against the reference layout, and the whole directory is replaced when React Navigation lands. |
| `TallyView` title from loaded data | Taken differently: the header now says "Tally" from every entry point, and the counterparty's name leads the screen body — so a notification and a list tap look the same, which was the actual complaint. |

## Fixtures that were wrong, not just screens

Three of the review's findings were fixture defects the screens then faithfully rendered. Worth
naming, because the fixtures are the de-facto engine contract until Nate's API exists:

- `tally.error.json` said *the tally could not be read* — contradicting story 04 path C, which is
  explicit that the tally reads. The story's own **Variants** line said the same wrong thing; that
  line was the root and is fixed too.
- `entry:0006` on `tally:sam-bike` answered a request on `tally:mara-shop`. Entries and tally details
  are now keyed by tally id, so the mistake is structurally harder to make, and a test asserts an
  entry only answers requests on its own tally.
- `attention.happy.json` carried English sentences. An engine will never hand the app prose; the
  fixture now carries `kind` and the screen writes the sentence through `t()`.

Derived values (`outstandingDays`, `waitingSince` → days) moved out of the fixtures and into the
adapters, which is the review's own preferred option: the same derivation runs in engine mode.

## What went into human-facing specs

The review asked which items *must* be specified rather than left to stories plus best practice.
Four, all of them cross-screen conventions that thirty screens would otherwise each invent:

- **`global/ui.md`** — a 14pt caption step (the explanatory lines are the product's voice and were
  sharing a size with metadata); direction never carried by colour alone; the estimate mark (`≈` plus
  the secondary colour); touch minimum, press feedback, chevron affordance, state chips; and the four
  places an icon may appear.
- **`global/i18n.md`** — plurals by the locale's rules.
- **`navigation.md`** § Behavior — hardware back, and replace-if-same-route.
- **`global/toolchain.md`** — the drift reconciled: what is installed, what is not, and the ticket
  for each gap.

Everything else in the review was inferable from the stories and specs as they stood. The screens
simply had not done it.
