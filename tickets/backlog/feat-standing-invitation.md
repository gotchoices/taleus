description: Let a vendor publish one invitation — a printed code, a link on a page — that many different customers can use, each ending up with their own separate tally.
prereq: feat-formation-lifecycle
files: docs/architecture.md, packages/taleus-app/design/stories/mobile/01-invite-a-partner.md, packages/taleus-app/design/stories/mobile/02-respond-to-an-invitation.md
difficulty: medium
----
## Why this ticket exists

A shop wants to put one code on the counter. Every customer who uses it should end up with their own
tally with the shop, on the terms the shop offers everyone. MyCHIPs supported this directly: a tally
invitation could be one-time or reusable, and each responder got a clone of the draft tally.

Sereus formation today records exactly one use per invitation, on both the bound and unbound paths,
so the reusable case has no mechanism. Without it, the only person who can tally with the shop is
whoever scans first.

This is a real use case, not a nicety — the retail/vendor scenario is one of the clearest paths to
adoption, and it is in the MyCHIPs baseline we are trying not to regress from.

## Outcomes we're after

- A vendor publishes one invitation and does not have to touch it again as customers arrive.
- Each customer ends up in a tally with the vendor and **only** the vendor — never in a shared or
  multi-party arrangement, and never able to see another customer's tally.
- The vendor states the terms once; each resulting tally starts from those terms and can then be
  negotiated individually (story 01 alternative C, story 02 alternative D).
- The vendor can see new tallies arriving as separate relationships.
- Whatever the mechanism, the customer's experience is the same as responding to a personal
  invitation — story 02 should not need a second version.

## Routes we know of

- **Multi-use invitations at the platform layer.** Ask Sereus for an invitation that can be redeemed
  N times (or unlimited), each redemption provisioning a fresh strand. This is the closest analogue
  to what MyCHIPs did, and it works from a printed code with nothing online at scan time. It is a
  platform change, and the current single-use accounting is what makes redemption safe today.
- **A live endpoint that mints invitations on demand.** The vendor's always-on node answers a stable
  URL and issues a fresh single-use invitation per visitor. Needs no platform change, but requires
  the vendor's node to be reachable at the moment a customer scans.

The story reads identically either way, which suggests the choice is genuinely an implementation
judgment. If the platform route is preferred, this ticket's first output may be a request to the
Sereus maintainer rather than code here.

## Open questions

- Whether a vendor's standing terms live in their portfolio as a reusable template, and whether that
  same template mechanism serves ordinary person-to-person invitations.
- Whether a standing invitation should be revocable, and what happens to a customer mid-redemption
  when it is revoked.
- Rate limiting and abuse: an invitation anyone can redeem is an invitation anyone can spam.
