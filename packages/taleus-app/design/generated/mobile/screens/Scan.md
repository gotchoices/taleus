---
provides: ["screen:Scan"]
mocks: [invitation]
dependsOn:
  - design/specs/project.md
  - design/specs/mobile/navigation.md
  - design/specs/mobile/screens/scan.md
  - design/specs/mobile/global/ui.md
  - design/specs/mobile/global/i18n.md
  - design/stories/mobile/02-respond-to-an-invitation.md
  - design/generated/mobile/screens/Scan.md
depHashes: {}
---

# Consolidation: Scan

## What was built

`apps/mobile/src/screens/Scan.tsx`, reached from the tally list's empty state ("I have an invitation"),
and `components/CodeCamera.tsx`, the camera that reads codes.

- **The camera reads QR codes** (react-native-vision-camera 5 with its ML Kit barcode scanner, Nitro
  modules like quick-crypto). Each distinct code is reported once. A code that is an invitation link
  (`data/inviteLink.ts` `inviteToken`) opens `ReviewInvitation`; any other says so, and the camera
  keeps looking.
- **The paste field takes the link or the bare invitation** and opens `ReviewInvitation` with it,
  which already says plainly when text is not an invitation. The app does not repeat the engine's
  token format to second-guess it.
- **Permission** is asked when the camera mounts (`useCameraPermission`); refused, the camera's frame
  says how to allow it, and pasting still works. `android.permission.CAMERA` in the manifest,
  `NSCameraUsageDescription` in `Info.plist`.
- The camera runs only while the screen is focused (`useIsFocused`).

## Not built here

Requests, standing codes and agreements' codes (`navigation.md` lists them for `Scan`); the PAY tab's
modal entry. The route sits in the TALLIES stack until the PAY tab exists.

## Validation

- `__tests__/scan.test.tsx`: a scanned invitation link opens the review; a foreign code is named and
  opens nothing; a pasted link and pasted invitation text both open it; the empty list's button goes
  here. The camera packages are mocked in `jest.setup.js`.
