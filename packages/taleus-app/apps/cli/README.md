# taleus (CLI)

Taleus on the command line -- for testing, evaluating and debugging Taleus, not for everyday
tallies. A client of `taleus-model` like the phone app, over a Sereus node kept in a party folder
(`taleus-sereus/node`).

- Stories: `design/stories/cli/` · commands and output: `design/specs/cli/commands.md`
- Runs as TypeScript directly on Node 24 (type stripping): no build. Build the workspace packages
  first (`yarn build` at the repository root).

```sh
alias taleus="node $PWD/src/main.ts"
taleus -p jan --listen                  # interactive; "help" lists the commands
taleus -p jan status                    # one command, then exit
```

## Two parties on one machine

```
A$ taleus -p jan --listen                B$ taleus -p sam --listen
taleus> party name Jan                   taleus> party name Sam
taleus> invite --limit 500 -o /tmp/link
                                         taleus> accept <the link> --yes
taleus> tallies                          taleus> tallies
```

`--listen` puts each party on its own loopback port, so they reach each other without a relay --
for one run. A tally's strand node listens on a new port every run, so once either party restarts
they find each other only through a relay: use `relay add relay.sereus.org` for anything that
spans runs (and to be reachable from a phone).

With no always-on node, a tally makes progress only while both parties are up: keep a party online
with `idle [<seconds>]`, or run its commands in one process (`-c "accept … --yes; idle 90; offer 1 accept"`).

## Scenarios

`scenarios/` drives two parties, Jan and Sam, through a tally's life with the CLI's own commands:
formed, paid (past the credit limit too), a request answered and one declined, a restart, closed.
Each party is a real one -- its folder, its cadre node -- run in one process, reaching the other
through a relay: a loopback one of its own by default, so a restarted party is found again.

```sh
yarn scenarios                                           # loopback relay; ~35 s on a RAM disk
TALEUS_SCENARIO_HOME=/Volumes/ram yarn scenarios         # party folders there (macOS fsync is slow)
TALEUS_SCENARIO_RELAY=<multiaddr> yarn scenarios         # through another relay, e.g. relay.sereus.org
```

Run it after any stack upgrade: it is the quickest way to tell a release that works from one that
does not, before a phone is involved.

## Profiling the stack

`scripts/` runs a whole formation between two CLI parties and says where the time went:

```sh
node scripts/profile-formation.ts --out /tmp/prof                 # debug logs on, loopback
node scripts/profile-formation.ts --out /tmp/prof --debug '' --cpu-prof --count-fsync
node scripts/analyze-profile.ts /tmp/prof sam 30.9 71.7           # busiest namespaces, longest silences
node scripts/summarize-cpu.ts /tmp/prof/cpu-jan/*.cpuprofile --from 0.8 --to 16.3
```

Each party is its own process (its own event loop, as two phones). `marks.jsonl` times every step the
CLI reports; `<party>.log` holds the stack's debug lines (`DEBUG=sereus:*,optimystic:*` by default,
FRET included). `--relay <addr>` runs it over a relay instead of loopback. Run it on a RAM disk
(`--out /Volumes/<ramdisk>/…`) to take the disk out of the measurement.
