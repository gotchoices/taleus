# Looking under the hood

Something is slow or stuck, and Kyle wants to see why.

1. `status` shows the node, its relay reservation, and how many tallies it holds.
2. `strands` shows each tally's strand: its status (syncing, active, hibernating) and who it is
   connected to.
3. `sql 1 "select * from App.TallyCore"` reads a tally's own tables, as the engine sees them.
4. `-v` puts the stack's own log lines on stderr.

## Acceptance

- [ ] Nothing here changes a tally: diagnostics only read.
