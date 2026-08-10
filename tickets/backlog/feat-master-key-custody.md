description: Work out how someone gets back into their account after losing every phone and tablet they own — including keeping a spare means of authority in a safe or a bank rather than on a device.
files: packages/taleus-app/design/stories/mobile/12-keys-and-backup.md, packages/taleus-app/design/stories/mobile/13-my-devices.md, packages/taleus-app/design/stories/mobile/50-recover-after-losing-a-device.md, docs/architecture.md
difficulty: hard
----
## Why this ticket exists

Taleus assumes a party is a set of devices that act together, and that losing one is survivable
because another remains. The design has one honest gap: a party who loses **every** device has, at
present, only one route back — a counterparty vouching for them. That route works, but it is a
social act rather than a technical one, it depends on the counterparty's willingness and judgment,
and the architecture already notes it can be abused by a malicious counterparty.

There is an obvious missing option: something the party keeps **off their devices entirely** — in a
safe, a deposit box, a sealed envelope — that can bring a new device back into service without
asking anybody. Sereus is expected to grow this capability; we would like our app design to be
compatible with that direction rather than to invent a parallel scheme.

The app-side stories that depend on this (`12-keys-and-backup`, and the still-unwritten
`13-my-devices` and `50-recover-after-losing-a-device`) were written against assumptions about how a
cadre behaves. Those assumptions need checking against what `@serfab/cadre-core` and the cadre host
actually do and plan to do.

## Outcomes we're after

- A party can put something away, once, that lets them re-establish themselves later from nothing
  but that item and a new device.
- Using it needs no counterparty and no other device — that is the entire point of holding it.
- Holding it is not itself dangerous: a person who keeps it in a drawer rather than a safe should
  understand what they have exposed.
- The party's identity survives the process. Recovering is not the same as becoming a new person, so
  history, tallies, and counterparty relationships stay intact.
- A party can find out what protections they currently have, in terms of what each protects against.
- Whatever emerges stays consistent with Sereus's own direction — this should not become a Taleus
  fork of cadre key management.

## Work this ticket covers

- **Check the stories against reality.** Read `12-keys-and-backup` (and the device/recovery stubs)
  against what cadre-core and cadre-host actually support today and intend to support. Note where
  the stories assume something that does not exist, and say whether the story or the assumption
  should move.
- **Establish what an off-device spare authority is** in this system, and what it can do: add a
  device, replace a lost set, something narrower.
- **Coordinate with the Sereus maintainer** on where this belongs. If the capability is platform-level,
  the output of this ticket may be a request upstream rather than code here.

## Open questions

- Whether this is one item or several, and whether losing it is itself a compromise that needs
  responding to.
- How it relates to the counterparty-attested route that already exists — alternative, complement,
  or fallback of last resort.
- What a person is actually told to do with it, given most people have no safe and will photograph it.
- Whether an always-on node in the party's own cadre changes the picture, since such a party always
  has a second device by construction.

## Not in scope

The app screens themselves — `feat-device-and-recovery-surface` covers presenting devices and
recovery to a person. This ticket is about what there is to present.
