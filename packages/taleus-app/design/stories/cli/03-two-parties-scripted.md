# Two parties, scripted

A test needs two parties to form a tally and trade, with no person at either end.

1. Two parties on one machine: `taleus -p jan --listen` and `taleus -p sam --listen` reach each
   other on loopback, so no relay is needed.
2. A script runs `taleus -p jan invite --limit 500 -o link`, then
   `taleus -p sam accept "$(cat link)" --yes`, then waits with `tallies` until both show the tally.
3. Each command line prints data only on stdout, tab-separated (or `--json`), and exits with a
   code saying whether it worked and whether trying again could help.

## Acceptance

- [ ] A script never has to parse prose: stdout is data, stderr is everything else.
- [ ] The same commands work at the prompt and in a script.
