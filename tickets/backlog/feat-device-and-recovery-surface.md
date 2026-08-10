description: Let people see and manage the devices that act for them, and get back to a working identity after losing a phone — including the case where nothing at all survives.
prereq: feat-engine-tally-api
files: docs/architecture.md, packages/taleus/schema/draft1.qsql, packages/taleus-app/design/stories/mobile/13-my-devices.md, packages/taleus-app/design/stories/mobile/50-recover-after-losing-a-device.md
difficulty: hard
----
## Why this ticket exists

In MyCHIPs a user was one key on one phone; losing it was catastrophic and the app's key management
was correspondingly simple — generate, export, import. Taleus is different by design: a party is a
**cadre** of devices, and the schema tracks a *set* of authorized keys per party, with revocation
and a counterparty-attested adoption path for the case where every key is gone.

That machinery exists (`PartyKey`, `PartyKeyRevocation`, `PartyKeyAdoption`, the `AuthorizedKey`
view). What does not exist is any way for a person to see or use it.

The architecture is blunt about the risk in the total-loss path: the counterparty's attestation is
the only thing authenticating a recovering party, so a malicious counterparty could unilaterally
re-key its counterpart. It states plainly that the app must surface that attestation as the trust
decision it is.

## Outcomes we're after

- A party can see which devices can currently act for them, and recognise each one.
- A party can add a device, and can remove one they no longer control — with the system preventing
  them from removing the last one.
- A party who still has one working device can recover from losing another, without help.
- A party who has lost everything can be re-established through a counterparty who vouches for them.
- The party doing the vouching understands what they are being asked to attest to, and that a
  careless yes hands over the other party's signing authority.
- Someone reading these screens can tell what would happen if they lost this device today.

## Open questions

- How an always-on node presents itself: another device, a service, or its own category.
- Whether device recovery and total-loss recovery are one story to the user or two clearly separate
  ones — they are very different in risk.
- What identifies a device to a human, given the underlying identity is a public key.
- Whether the app should actively push a party toward a second device or a backup before they hold
  meaningful value, and how insistent that should be.
- What a party can still *see* while unable to sign, and how that state is described without alarming
  someone whose money is fine.

## Not in scope

Key material storage on device (platform keystores, biometrics) — a separate concern once the shape
of this surface is known.
