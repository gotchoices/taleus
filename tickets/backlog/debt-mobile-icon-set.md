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

Install `react-native-vector-icons` (10.3.0 is current) and use it in exactly the four places above.

Unlike `react-native-screens`, this one is **not** blocked by the app's React Native version: its
`codegenConfig` declares `"type": "modules"`, so it generates a TurboModule spec and never goes
through the component-command path that rejects `react-native-screens` on React Native 0.82
(`debt-mobile-navigation-library`). It should install and build as-is.

Worth sequencing behind the React Native upgrade anyway, because React Navigation's `bottom-tabs`
supplies the tab bar the icons would go in, and doing the tab bar twice is wasted work.

Text glyphs (`›`, `+`, `−`) stand in until then, which is enough for the chevron and the direction of
an amount but not for a tab bar.
