# UI (Mobile)

Shared visual foundations. Screens reference tokens by name, never raw hex.

## Decisions

- **Theme**: user-selectable — system | light | dark
- **Icon set**: Ionicons (as in the sibling Sereus apps); feature specs name the icons they use
- **UI kit**: none — plain React Native components
- **Brand mark**: the logo (`docs/images/logo4.svg`, indigo diamond + tally-stick handover) appears
  once — as the header-left mark on the `TallyList` root, ~26pt, `accessibilityLabel` "Taleus",
  decorative. The in-app PNG and the launcher icons are generated from it by
  `apps/mobile/scripts/logo-gen-*.sh`

## Colors (semantic tokens)

`accent` is the brand color — a deep indigo, chosen to sit apart from Sereus Health
(monochrome) and Sereus Chat (green). `positive` / `negative` carry the direction of a value;
stories decide when a value counts as which.

Light:
- background: #ffffff   surface: #ffffff    surfaceAlt: #f3f4f8
- textPrimary: #111111  textSecondary: #555555
- border: #e2e2e2
- accent: #4a3fbf       accentText: #ffffff
- positive: #1a7f5a     negative: #b3261e   bannerError: #ffeeee

Dark:
- background: #000000   surface: #111111    surfaceAlt: #1b1c24
- textPrimary: #eeeeee  textSecondary: #bbbbbb
- border: #2a2d31
- accent: #8f86f0       accentText: #131033
- positive: #37b283     negative: #f2b8b5   bannerError: #330000

## Spacing scale

4, 8, 12, 16, 20, 24

## Typography

- Title: 20 / 600
- Body: 16 / 400
- Caption: 14 / 400 — the explanatory lines that teach; read on every visit
- Small: 12 / 400 — metadata only (dates, who signed, ageing)

The captions are the product's voice, not chrome. They do not get the metadata size.

## Amounts

Every amount appears with its unit of account — a party holds tallies in more than one
(`design/specs/domain/rules.md`). Amounts use tabular figures so columns align.

Figures converted into the display unit are estimates and are marked as such, distinctly enough
that an estimate is never mistaken for a signed balance: a leading `≈` and the secondary text
color, so the difference survives a glance and a greyscale screen.

**Direction is never carried by color alone.** Wherever an amount has a side, it appears in words
and as a sign or arrow, with color as the third cue. A reader who cannot distinguish the colors
loses nothing.

## Interaction

Cross-screen conventions, so thirty screens do not each invent one.

- **Anything tappable looks tappable**: a pressed state always; a trailing chevron on a row that
  opens something. Nothing that is not tappable wears either.
- **Touch targets**: 44pt minimum (48dp on Android), whatever the text size.
- **Tally states and waiting-on** appear as filled chips, not inline gray text — the *waiting on me*
  case is what a party opened the app to find.
- **Icons** appear in four places and nowhere else: the tab bar (always with its label), the row
  chevron, the direction of an amount, and state chips. An icon without a label must be one every
  user already knows.
- **Accessibility** is not deferred: roles on anything actionable, selected state on the active tab,
  and an amount's direction in its label, not only in its color.
