description: The mobile app has no icon set, so the tab bar is bare words and rows carry no affordance, both of which the UI spec now requires.
files: packages/taleus-app/apps/mobile/src/navigation/index.tsx, packages/taleus-app/design/specs/mobile/global/ui.md
difficulty: easy
----
## What happened

`design/specs/mobile/global/ui.md` chose Ionicons, as in the sibling Sereus apps, and its
§ Interaction section names the four places icons belong: the tab bar (always with its label), the
chevron on a row that opens something, the direction of an amount, and state chips. The first slices
installed nothing — `react-native-vector-icons` is a native dependency, and the early screens could
be read without it.

That is no longer true. The tab bar is three 12pt words on a hairline and will hold five; nothing on
any screen looks tappable.

## What would resolve it

Install the icon set (`react-native-vector-icons`, or `@expo/vector-icons` if the app ever moves to
Expo), confirm it builds against the React Native version in use — the same check that
`debt-mobile-navigation-library` failed — and use it in exactly the four places above.

Text glyphs (`›`, `↑`, `↓`) stand in until then, which is enough for the chevron and the direction
of an amount but not for a tab bar.
