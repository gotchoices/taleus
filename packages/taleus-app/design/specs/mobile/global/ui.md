# UI (Mobile)

Shared visual foundations. Screens reference tokens by name, never raw hex.

## Decisions

- **Theme**: user-selectable — system | light | dark
- **Icon set**: Ionicons (as in the sibling Sereus apps); feature specs name the icons they use
- **UI kit**: none — plain React Native components

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
- Small: 12 / 400

## Amounts

Every amount appears with its unit of account — a party holds tallies in more than one
(`design/specs/domain/rules.md`). Amounts use tabular figures so columns align.

Figures converted into the display unit are estimates and are marked as such, distinctly enough
that an estimate is never mistaken for a signed balance.
