# Screen Spec: scan

---
id: scan
route: Scan
variants: [happy]
---

Opens what someone handed over in person (`navigation.md`: "open anything handed over in person").
Story 02 is the first use: a party who has the app and was given an invitation, by a code to scan or
a link to paste, gets to it from the tally list's "I have an invitation".

## What it must do

- **Two ways in, on one screen:** the camera, reading a code; and a field to paste a link into. The
  paste field stays usable when the camera is not: permission refused, no camera, an emulator.
- **An invitation opens `ReviewInvitation`.** A scanned code counts when it is an invitation link
  (`https://sereus.org/taleus/invite/#…`), which is what Taleus's codes carry. Pasted text may be the
  link or the bare invitation; `ReviewInvitation` says plainly when it is not one. Scanning or pasting
  accepts nothing: the party reviews the terms there.
- **A code that is not an invitation is named, not guessed at,** and the camera keeps looking.
  Requests, standing codes and agreements' codes are not handled here yet.
- **Camera permission is asked when the screen opens**, with one line on why. Refused, the screen
  says how to allow it in the phone's settings and keeps the paste field.

## Notes

- One code is acted on once: the camera reports the same code many times a second.
- The phone's own camera app also opens an invitation's code, since the code is the invitation link;
  this screen is for a party already in the app.
