# UI/UX review — first five mobile screens

Scope: `TallyList`, `TallyView`, `TallyHistory`, `Attention`, `Position` as generated in
`apps/mobile/src/` (commit `2c0a2d1`). Reviewed against the stories, the specs, the appeus rules, and
the running build on `emulator-5560` — light and dark, happy/empty/error variants, and 1.3× font
scale. Committed screenshots are under `generated/mobile/images/`.

Findings are graded **must** (wrong against a story or spec, or a defect a user would hit),
**should** (best practice, cheap to fix now, expensive later), and **consider** (judgement calls).

## Summary

The screens say the right things. The language is the product's real differentiator — perspective
stated in words, estimates named as estimates, credit kept apart from value held — and the generated
code takes those rules seriously. Where it falls short is in the things stories do not spell out and
specs left implicit: direction is carried by colour alone, several data fields that the stories
require are typed but never rendered, dates render a day early, the request direction is ignored,
Android back exits the app, and there is no touch affordance anywhere. The foundation is sound in
its data shapes and weak in its UI plumbing (five copies of the same load state machine, styles
rebuilt per row, no theme hook, no navigation library).

Text-first is the right call for this app. Icons should be added in exactly four places (tab bar,
row affordance, amount direction, state badges) and nowhere else — see the last section.

## 1. Does it honour the stories?

### Must

- **Request direction is ignored.** `TallyView` "Being asked of you" and `TallyHistory` "Still being
  asked" both show `request:jan-sam-60` — which the fixture marks `asked-by-me` (Jan asked Sam for
  "Wheel truing"). The caption under it reads "A request is what they say you owe." Story 24 step 7
  and story 21 step 6 need both directions, each labelled. `PaymentRequest.direction` exists in
  `src/data/requests.ts` and is never read. Neither screen can currently distinguish "they want $60
  from me" from "I am waiting on $60 from them".
- **Balance-after has no side.** `TallyHistory` prints "Balance $180.00". `balanceAfter.perspective`
  is in the fixture and dropped. The app's first rule (`tally-list.md`: "neither party has to work
  out a sign") is broken on the one screen whose purpose is following the balance back (story 24
  step 4).
- **Entry direction is colour-only.** An entry's "which way it went" (story 24 step 2) is expressed
  solely as green/red on the amount. No sign, no word, no glyph. Fails WCAG 1.4.1 and is unreadable
  for the ~8% of men with red-green deficiency. The sign convention for `Entry.amount` (positive =
  toward me?) is also undocumented in `types.ts`, so even the colour is an inference.
- **Dates render a day early.** Fixture `2026-03-02T00:00:00Z` shows as "Mar 1, 2026"; `2026-08-21T03:11Z`
  as "Aug 20". `formatDate` renders a UTC instant in local time for a value that is semantically a
  date. Terms "in force since" and entry dates are both affected. Decide whether the engine hands
  the app dates or instants, and format accordingly.
- **Terms "in force since" shows one date for two directions.** `TallyView` prints
  `terms.mine.effective` only; `terms.theirs.effective` (Nov 2025 in the fixture) is never shown.
  Story 07 step 3 and spec: "the date the terms took effect is visible" — there are two.
- **Unreachable ≠ unreadable.** `tally.error.json` says "Nothing of Sam's is reachable just now" and
  the screen renders it as *the tally could not be read*. Story 04 path C is explicit that this is
  wrong: "Sam can still see the tally and its terms — this is his record too." The error fixture
  contradicts the local-first premise. The variant the story actually wants is *tally readable,
  pending things marked pending*.
- **Attention items are inert and undated.** Every item is a `Pressable` with no `onPress`;
  `AttentionItem.route` and `waitingSince` are in the fixture and unused. Story 23 step 3 requires
  "how long it has been waiting"; step 4 requires getting to the thing. The Northwind item could
  already route to `TallyView`.
- **An offered tally is shown with a balance.** `Rae Whitfield — settled — 0.000 CHIP — Needs you —
  Offered`. An offer has no balance and is not "settled". Story 06 path C: "outstanding invitations
  are findable too, and are not mistaken for open tallies." The row should lead with the state and
  suppress the figure.
- **`TallyView` offers no next action.** Story 04 step 7 and its acceptance criterion ("a tally with
  no history is presented as normal, with next actions offered"); `tally-view.md` description ends
  "…and what to do next." The only action is *See history*. Even before Pay/Request/Terms are
  sliced, the affordances should exist (disabled or routing to a stub) so the screen's shape is
  right.

### Should

- **`TallyList` omits last activity.** `tallySummary.lastActivity` and the `tally-list.last-activity`
  string both exist, neither is used. Story 06 steps 4 and path B (three Chens, told apart by
  recency) depend on it.
- **Entries do not show what they answered.** `Entry.answers` is typed, in the fixture, and not
  rendered. Story 24 step 6 / acceptance "an entry that answered a request is recognisably tied to
  that request." (The fixture is also wrong: `entry:0006` on `tally:sam-bike` answers
  `request:mara-95`, which is on `tally:mara-shop`.)
- **The estimate is not visually an estimate.** `ui.md` § Amounts: converted figures are "marked as
  such, distinctly enough that an estimate is never mistaken for a signed balance." `$137.50` on
  Position is set identically to the exact figures above it; only a 12pt caption says otherwise.
  Prefix with ≈, use `textSecondary`, or italicise — something that survives a glance.
- **Estimate shows only net.** Story 40 step 2 is emphatic that owed and owing are shown separately;
  the estimate fixture carries `owedToMe`/`owedByMe`/`net` and the screen renders only `net`, under
  the label "Net", which is jargon the rest of the app avoids.
- **Zero coloured as if it meant something.** Position's CHIP card: `0.000 CHIP` in green and
  `0.000 CHIP` in red. "You owe 0 Dave-hours" in red reads as a warning about nothing. Colour should
  follow `perspective === 'level'` → neutral, as `TallyList` already does.
- **Story 04's central scene cannot be shown.** The story is about a *new* tally: zero balance,
  explained, with next actions. No fixture exists for it (`tally.*.json` has only Sam's $180 tally);
  `screens/index.md` lists an `empty` variant for `TallyView`, `tally-view.md` does not. Add a
  zero-balance fixture and reconcile the two.
- **Attention items double-label.** "Terms proposed" (fixture `summary`) then "Terms to answer"
  (kind); "Asking for payment" then "Payment requested". One line per fact.

## 2. Does it honour appeus?

The consolidations are honest about what was not built, staleness hashes are current, mock variants
never leak into screens, and the domain contract is mirrored in `types.ts`. Deviations:

### Must

- **Fixture prose is user-visible text.** `attention.happy.json` carries English sentences
  (`"summary": "Closing — waiting on them to settle"`) that the screen prints verbatim. `i18n.md`:
  "No user-visible string is written into a screen. Screens reference keys." An engine will never
  hand the app English; `summary` should be derived from `kind` + data through `t()`. As it stands
  the Attention screen cannot be localised.
- **Hard-coded unit fallbacks in UI.** `Attention.tsx` `denom ?? 'iso4217:USD'`, `scale ?? 2`;
  `Position.tsx` the same for spending power. `i18n.md`: "units are data, not translations";
  `rules.md`: no unit is privileged. If an amount can arrive without a unit, that is an adapter
  bug to fix in the data layer, not to paper over with dollars in a screen.
- **`readTally` ignores its id.** Tap Mara in the list → header says "Mara's Bike Shop", body says
  "Sam Ortiz owes you". Mock limitation, but it is what every reviewer of the scenario build will
  see first. Key `tally.*.json` by id (or make the fixture a map).

### Should

- **Toolchain drift is documented but compounding.** `toolchain.md` names react-navigation and
  zustand; `i18n.md` names i18next + react-native-localize; `ui.md` names Ionicons. The app has none
  of the four. The navigator substitution is tracked as `debt-mobile-navigation-library` and the
  reasoning (react-native-screens vs RN 0.82) is sound; the other three are not tracked anywhere.
  Either amend the specs to what was decided or open tickets, so the next slice does not have to
  rediscover the gap.
- **Key style.** `i18n.md` specifies namespaced keys (`screens.tally-list.empty-message`). Actual keys
  are un-namespaced (`tally-list.empty-title`). Trivial now, painful after 30 screens.
- **Locale never reaches `Intl`.** `formatAmount`/`formatDate` default `locale = 'en'` and no caller
  passes anything else. `i18n.md`: "formatted with `Intl` against the active locale." The `?locale=`
  deep-link override in `navigation.md` is not implemented.
- **Plurals.** `"{days} days' notice"`, `"Outstanding {days} days"` — "1 days'" at day one. `Intl.PluralRules`
  or i18next plurals; another reason to take the library now.
- **RN reference layout.** `frameworks/react-native.md` puts deep-link config in
  `navigation/linking.ts` and route types in `navigation/types.ts`. Here it is `routes.ts` plus a
  regex inside `index.tsx`. Aligning costs nothing before the real navigator lands.
- **`tally-list-happy.png` is a spinner.** The committed happy-path capture of the launch route shows
  the loading state, not the list. The scenario set is missing its most important image.

## 3. Best practices

### Must

- **Android back exits the app.** No `BackHandler`; from `TallyView` the hardware/gesture back leaves
  Taleus instead of popping to the list. This is the single most-hit defect on Android.
- **Touch targets.** Tab items are 12pt text with 8pt vertical padding (~28pt tall); "Back" is bare
  text with `hitSlop` 8. Platform minimum is 44pt (iOS) / 48dp (Android). Rows are fine.
- **No press feedback, no affordance.** No `android_ripple`, no pressed style, no chevron or
  trailing glyph. Nothing on any screen looks tappable; on Attention this is compounded by the items
  actually *not* being tappable, so the user cannot tell dead from live.
- **Accessibility is absent.** No `accessibilityRole` on tabs, buttons, or rows; no `accessibilityState`
  `selected` on the active tab; amounts in colour carry no `accessibilityLabel` saying the direction.
  `project.md` names accessibility as a delivery-posture requirement.
- **Error details are dropped.** `Attention`, `Position`, `TallyHistory`: `if (!result.ok) { setState('failed'); return }`
  discards `result.error`, so the message is lost and `retryable` defaults to `true` even when the
  adapter said otherwise. `tally-list.md`: "offers to try again when trying again could help."

### Should

- **Status bar.** Grey band at the top in both themes — `StatusBar` has no `backgroundColor`
  / `translucent`. Should paint `tokens.background`.
- **12pt is doing too much.** All secondary information — who recorded an entry, balance after,
  outstanding days, every explanatory caption — is `small` (12/400). The captions are the app's
  pedagogy; they should be readable without effort. Add a 14pt "caption" step to `ui.md`; keep 12
  for true metadata.
- **`TallyView` header title depends on route.** From the list it is the counterparty's name; from a
  deep link (and therefore from a notification) it is "Tally". Title from loaded data, not params.
- **Deep link repeatedly pushes.** `navigate()` appends to the tab's stack on every non-root link;
  opening the same notification twice yields TallyView → TallyView. Replace-if-same-route.
- **Lists have no pull-to-refresh** and no `ListEmptyComponent` path once a filter exists.
- **Loading flashes.** Fixtures resolve in a tick and the full-screen spinner still paints. Delay the
  spinner ~150 ms or keep the previous content while reloading.
- **Inconsistent casing.** `TallyList` sub-labels are lowercase ("owed to you", "settled"); the same
  ideas elsewhere are sentence case ("Owed to you"). Pick one.

## 4. Is it a solid foundation?

Data layer: yes. `Result<T>` instead of throws, perspective carried in the data, whole-number
amounts, one switch point in `config.ts`, fixtures shaped to the contract — this is the part the
remaining 25 screens can build on unchanged.

UI layer: not yet. The next slice will copy whichever screen it resembles, so these matter now:

- **Five copies of the load state machine.** `useState` × 3, `useCallback` load with try/catch,
  `useEffect`, three early returns — verbatim in every screen, with the error-dropping bug in three
  of them. One `useLoad(fn, deps)` hook returning `{ state, value, error, reload }` plus one
  `<Loaded>` wrapper removes ~40 lines per screen and fixes the bug once. The "Defensive loading"
  paragraph is pasted into all five consolidations for the same reason.
- **Theme is not a hook.** `useColorScheme() === 'dark' ? dark : light` in every screen and in the
  navigator. `ui.md` says theme is user-selectable (system | light | dark), which this cannot do.
  `useTokens()` backed by context, now, before the settings screen has to retrofit it.
- **Styles rebuilt per render.** `makeStyles(tokens)` calls `StyleSheet.create` on every render, and
  `TallyRow` calls it *per row*. Memoise by token set, or make `useTokens()` return styles too.
- **Shared components duplicated.** `components/Screen.tsx` provides `Loading`/`Failed`/`Empty`;
  `TallyList` reimplements all three inline. `Section` and `Row` in `TallyView` are the card
  vocabulary Position also uses, reimplemented there. `components/index.md` is still the template
  with no rows. Promote `Card`, `Row`, `Amount`, `StateBadge`, `EmptyState`, `FailedState` and list
  them.
- **No `Amount` component.** Every screen calls `formatAmount` and colours the result by its own
  rule (List: by perspective; History: by raw sign; Position: by row). One component taking
  `{ amount, unit, perspective }` and owning colour, tabular figures, sign/glyph, and the estimate
  mark is where rules 1, 3, and the ui.md estimate requirement get enforced once.
- **Navigator.** Fine as a stopgap. Its shape (`{ route, navigation }`) is right. But the tab set is
  three of the five in `navigation.md`, and hardware back, modal routes (`Scan`), and
  stand-alone notification entry (`ReviewOffer` etc.) are all things the hand-rolled version will
  need before the real one is affordable. Set a slice number by which react-navigation lands.
- **Derived values in fixtures.** `outstandingDays`, `roomToSpend`, `requestsOutstanding` are
  computed values stored in fixtures. The engine will hand the app `asked` timestamps and limits;
  either the adapter derives them (good — same code in engine mode) or the app does. Decide before
  the fixtures multiply.
- **Cleanup.** `@types/react-native` (obsolete, RN ships its own types); unused `Empty` import in
  `TallyView`; unused `heading` style; `data.test.ts` is the only test that exercises adapters.

## 5. Mostly text, not icons — good or bad?

Mostly good, with four specific exceptions.

**Why text is right here.** The stories are written in a voice that explains as it goes — "Credit
they extended you — not value you hold", "Only signed entries move the balance." That voice *is* the
product: theory.md is a conversation, story 40 exists to teach net worth. Every screen above teaches
something a Venmo user does not know, and no icon teaches. A tally app that leaned on glyphs would
look like a banking app and mislead accordingly. The explanatory captions are the most valuable
text on the screens and should stay.

**Where it is bad.**

1. **Tab bar.** Three 12pt words on a hairline is the weakest possible wayfinding; with five tabs it
   will not fit. `ui.md` already chose Ionicons, and tab icons are the convention on both platforms.
   Icon + label, always both.
2. **Row affordance.** Rows read as a document, not a list of things to open. A trailing chevron
   (or a pressed state) is the smallest fix and is what tells a user the row is live.
3. **Direction of amounts.** "Owed to you" as words is correct and must stay, but on a list of forty
   the eye needs the direction before the words — an arrow or +/− beside the figure, in addition to
   the word and the colour. This is also the accessibility fix.
4. **State badges.** "Needs you", "Offered", "Closing" as 12pt grey inline text are invisible on a
   long list. Still text — but as a chip with a fill, so the *waiting-on-me* case (the one that is
   a demand) is findable at a glance, which is the whole point of story 06 path A.

**Where it will become bad.** The captions are read every visit. The tenth time Jan opens Position
he does not need "Credit is somebody's willingness, not value you hold." Plan progressive
disclosure: caption shown until dismissed or N views, then a tappable ⓘ. Not for this slice, but
the `Card` component should have a slot for it.

**Do not** add icons for decoration, for section headers, or in place of any word that carries the
perspective. If an icon appears without a label, it has to be one every user already knows
(chevron, back, search, close).

## Suggested order

1. Fix the correctness items in § 1 and § 2 *must* — request direction, balance-after side, entry
   sign, dates, terms dates, unreachable-vs-unreadable fixture, error-detail loss, `readTally` by id.
2. `useLoad`, `useTokens`, `Amount`, `Card/Row`, `StateBadge` — before slice six copies the current
   pattern.
3. `BackHandler`, touch targets, press feedback, accessibility roles, status bar.
4. Tab icons, row chevrons, direction glyphs, state chips.
5. Re-capture the scenario set (happy list is a spinner), add the zero-balance tally fixture.
