description: The mobile tab bar now uses Ionicons with labels, closed as part of the React Native 0.87 upgrade.
files: packages/taleus-app/apps/mobile/package.json, packages/taleus-app/apps/mobile/src/navigation/routes.ts, packages/taleus-app/apps/mobile/src/navigation/index.tsx
----

## What landed

`@react-native-vector-icons/ionicons` 13.1.4. The umbrella `react-native-vector-icons` package is
deprecated in favour of per-family packages, so only the Ionicons family is pulled in.

Icons appear in the three places the app has so far, and nowhere else, per `global/ui.md`
§ Interaction:

- **Tab bar** — `list` / `notifications` / `wallet`, outline when inactive and filled when active,
  always with the label beside them. Never an icon alone.
- **Row chevron** — a text `›` on `OpenableRow`, which needs no font.
- **Direction of an amount** — `+` / `−` beside the figure, alongside the word and the colour, so
  direction never depends on any one of the three.

The fourth place — state chips — remains text on a fill, which is what `ui.md` asks for.

## Note on the earlier diagnosis

This ticket originally said the icon package needed checking against React Native 0.82, "the same
check `react-native-screens` failed." It would have passed: `react-native-vector-icons` declares
`"type": "modules"` in its `codegenConfig`, so it generates a TurboModule spec and never touches the
component-command path that rejected `react-native-screens`. It was sequenced behind the React Native
upgrade for a better reason — React Navigation's `bottom-tabs` supplies the tab bar the icons go in,
and building that tab bar twice would have been waste.

## Verification

Release APK builds with the font asset bundled (`Copying 20 asset files`), installs, and the tab bar
renders icon + label in both the active and inactive states — see
`design/generated/mobile/images/tally-list-happy.png`.
