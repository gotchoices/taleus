# taleus-sereus

Taleus on Sereus: each tally a closed two-party Sereus strand, behind `taleus-core`'s
`StoreProvider`. Platform-neutral -- it imports `@serfab/cadre-core` and nothing platform-specific --
so every host uses it: the phone app (over `@serfab/cadre-rn`'s phone node), a CLI or `taleus-node`
(over a Node `CadreNode`), a browser. The host builds and starts the node; this package turns it
into tallies.

- **`cadreStoreProvider({ node, sApp })`** -- `create` founds a tally's strand and mints a
  single-use strand invitation, which travels in the ticket's `ref.address`; `join` redeems one and
  waits for the strand. Every strand reaches the store as `strand:discovered` and is attached once,
  so a restarted node gets its tallies back. A strand the node hibernated (a phone app in the
  background) is woken before it is read; one still on its first sync is left out of `list()`.
- **`taleusSApp()`** -- the tally sApp (schema `taleus-core/schema-text/draft1`), unsigned until
  Taleus signs it at release.
- **Strand addresses** (`address.ts`) -- the compact `{ t, e, b }` form an invitation carries,
  keeping only the WebSocket bootstrap addresses a phone can dial.

## `taleus-sereus/node` (Node only)

A party's cadre node kept in a folder (`~/.taleus/<name>/`, or `$TALEUS_HOME`): what a CLI, a
scenario test or `taleus-node` runs where the phone runs the kit's phone node. `partyDirs` /
`openParty` / `lockParty` manage the folder (keys, blocks, node records, slots, `party.json`);
`startPartyNode` starts a phone-shaped node over it (transaction profile, relays, no hibernation)
and enrolls it as its own owner; `fileSlot` gives the engine its state, identity and document
slots as files; `loopbackListenAddress` lets two parties on one machine reach each other without a
relay. Built separately (`tsconfig.node.json`) so the package root never sees Node's types.

`yarn test` runs two `CadreNode`s over loopback: forming, opening and carrying entries with no
polling, an invitee restart, a partner gone before the joiner holds the tally, a hibernated
tally read back, and two folder-kept parties forming a tally and one restarting from its folder.
