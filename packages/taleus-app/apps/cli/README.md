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
