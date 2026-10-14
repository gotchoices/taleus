# taleus — commands and output

The command-line client (`apps/cli`). Stories: `design/stories/cli/`. It is a client of
`taleus-model` like the phone app: every command is one or a few `TaleusModel` calls, over a
Sereus node kept in a party folder (`taleus-sereus/node`). The shape follows sereus chat's CLI
(`chat/design/specs/cli/commands.md`); where nothing Taleus-specific is at stake, it behaves the same.

## Invocation

```
taleus [global options]                       interactive (stdin is a terminal)
taleus [global options] < script              one command per line from stdin
taleus [global options] <command> [args] [\; <command> [args] ...]
taleus [global options] -c '<command>; <command>'
```

- With a command, taleus starts the party's node, gives it a bounded time to settle (`--wait`),
  runs the commands in order, and stops. There is no background process.
- `;` as its own argument separates commands (quote it in the shell). `-c` takes one string and
  splits it as the prompt does: spaces separate, quotes group, `\` escapes, `#` starts a comment.
- A command can be shortened to any unique beginning of its name. Scripts should spell commands out.
- The prompt keeps history (`history` in the party folder). `quit` or Ctrl-D leaves; Ctrl-C stops a
  running `watch` or `idle`.

### Global options

| Option | Meaning |
|---|---|
| `-p, --party <name>` | Party to use (default `default`) |
| `--home <dir>` | Where parties live (default `$TALEUS_HOME`, else `~/.taleus`) |
| `--json` | JSON lines instead of tab-separated lines |
| `--header` | A column header line first (tab-separated output only) |
| `--relay <multiaddr>` | Also use this relay for this run (repeatable) |
| `--listen [<multiaddr>]` | Also listen, so peers can dial in directly. Default: loopback on a port chosen on first use and kept, so two parties on one machine reach each other without a relay. Only the party's control node keeps its port: each tally's strand node listens on a new one every run, so after a restart the two find each other only through a relay |
| `--wait <seconds>` | One-shot: how long to let the node settle before running (default 30) |
| `-v, --verbose` | The stack's log lines on stderr |
| `-h, --help` · `--version` | |

## The party folder

`~/.taleus/<party>/` (mode 0700), from `taleus-sereus/node`. Deleting it is a clean slate. A folder
made by an older stack is refused, not misread. One process per party: a second is refused,
naming the first.

| Path | What |
|---|---|
| `party.json` | Sereus party id, relays, listen port, data format, created-at |
| `keys/` | the node identity. Anyone with it is this node |
| `blocks/<scope>/` | strand and control block storage |
| `node/` | the node's own records: owners, peers, machines, strand network state |
| `slots/` | the engine's state, the Taleus identity (signing key), contract documents |
| `last.json` | the rows of the last `tallies` listing, for row references |
| `history` | prompt history |

## Naming tallies

A tally is named by its row in the last `tallies` listing (`2`), its id or a unique beginning of it
(at least 4 characters), or its counterparty's name (case-insensitive) when no other tally has it.
An ambiguous or unknown name is an error (exit 4) listing the candidates.

## Amounts

Typed in the tally's unit, as written: `12.50` on a dollar tally is 1250 cents. More decimal places
than the unit has is a usage error, never rounded. Printed the same way, with the unit's code
(`12.50 USD`). Output never combines units.

## Output

- **stdout is data only.** Progress, previews, questions, warnings and errors go to stderr.
- **One record per line**, fields separated by a tab, in the documented column order. Inside a
  field, tab is `\t`, newline `\n`, backslash `\\`. Empty fields are empty.
- **Ids** in full. **Times** ISO 8601 UTC. Listings start with a row number.
- **`--json`:** one JSON object per line, fields named as in the column lists.
- **Key/value commands** (`status`, `party`, `tally`) print `key<TAB>value`; multi-valued keys repeat.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Done |
| 1 | Usage: unknown command, bad option, a malformed amount |
| 2 | Failed, and trying again will not help |
| 3 | Failed, and trying again may help (the model's `retryable`) |
| 4 | No such tally, or an ambiguous name |

With several commands, taleus stops at the first failure and exits with its code.

## Commands

Columns in order. `[…]` optional, `<…>` required.

### `status`
Key/value: `party` (folder name), `sid` (the Taleus identity, empty before `party name`), `name`,
`peer`, `partyId` (Sereus), `relay` (repeat: `status<TAB>multiaddr`), `address` (repeat), `tallies`.

### `party [name <name>]`
Key/value: `sid`, `name`. `party name <name>` creates the Taleus identity on first use and sets the
name others see. Commands that act on tallies need it first.

### `relay` · `relay add <host[:port] | multiaddr>` · `relay remove <multiaddr|row>`
As in chat's CLI: a host name is enough (`relay.sereus.org`); its published address is used, else
WebSocket port 4011 plus the peer id learned by connecting, and taleus says how the id was
obtained. Saved relays apply to later runs; adding or removing restarts the node and waits up to
30 s for a reservation. List: `row  status  multiaddr`.

### `agreements`
The agreements this party can offer, from its trusted publishers: `row  id  title  publisher`.

### `invite [--limit <amount>] [--notice <days>] [--unit USD|CHIP] [--agreement <row|id>] [--valid day|week|month] [--note <text>] [-o <file>]`
Makes an invitation (a new tally). Defaults: limit 0, notice 30 days, USD, the first agreement, a
week. Prints `token  link  expires`. `-o <file>` also writes the link alone, one line, mode 0600:
whoever holds the link can take up the invitation.

### `invites`
`row  token  note  state  limit  notice  expires`.

### `accept <link|token> [--limit <amount>] [--notice <days>] [--yes]`
Shows who invites and on what terms (stderr) and asks; `--yes` skips the question (required when
stdin is not a terminal). Prints `answer`.

### `tallies`
`row  id  counterparty  balance  perspective  state  waitingOn  lastActivity`. An invitation nobody
has taken up shows its note as the counterparty.

### `tally <tally>`
Key/value: `id`, `counterparty`, `state`, `waitingOn`, `balance`, `perspective`, `myLimit`,
`myNotice`, `theirLimit`, `theirNotice`, `roomToSpend`, `agreement`, `opened`.

### `offer <tally> [accept]`
Shows the terms proposed on a tally (key/value: `waitingOn`, `myLimit`, `myNotice`, `theirLimit`,
`theirNotice`, `agreement`), or accepts them. Countering is the phone's for now.

### `history <tally> [-n <count>]`
Entries oldest first, default the last 20: `row  id  date  issuer  amount  balanceAfter  memo`.

### `pay <tally> <amount> [<memo...>]`
Records value given to the partner. Prints the entry as `history` does.

### `request <tally> <amount> [<memo...>]` · `requests [<tally>]`
Asks the partner to pay, or lists requests: `row  id  tally  direction  amount  stillAsked  state  memo`.

### `attention`
What waits on this party: `row  kind  tally  counterparty  amount  waitingOn  waitingDays`.

### `watch`
Follows: each time anything changes, prints the tallies that changed as `tallies` does (row empty),
until Ctrl-C.

### `strands`
Diagnostics: each tally's strand on this node: `row  tally  status  connections`.

### `sql <tally> <query>`
Diagnostics: runs a read on the tally's strand database and prints its rows as JSON lines.
Read-only use only; nothing stops a write, so do not.

### `idle [<seconds>]`
Keeps the node running -- reachable, syncing, the agent acting -- for that long, or until Ctrl-C.
With no always-on node, a tally makes progress only while both parties are up, so a script keeps a
party online with it.

### `help [command]` (also `?`) · `quit`

## Not yet

Countering an offer, closing a tally, lifts, rates, disclosure and devices: the phone has them;
they fit the same patterns when wanted.
