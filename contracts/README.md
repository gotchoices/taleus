# Taleus contracts

The tally contract documents sereus.org publishes for Taleus, in [Stroc](https://github.com/gotchoices/stroc)
format. A tally names the contract it is under only by CID (`TallyContractProposal.ContractCid`,
`TallyContract.ContractCid`); the documents themselves are published here and kept by the parties'
apps, not written into the tally.

The set is the MyCHIPs contract library (as revised 2024-02-06), converted by Stroc, re-authored
to `sereus.org`, and revised for Taleus: protocol and publisher names, no servers (a tally is one
shared record on both parties' devices), key sets rather than one key, credit terms named as in the
schema, and a new `Denomination.yaml` (Unit of Account) carrying the clauses that used to assume
CHIPs so a tally may be kept in any unit. `CHIP_Definition.yaml` now defines only the CHIP itself. Dispute remedies are their own clause so
the top-level agreement comes in variants a party chooses between when inviting:
`Tally_Contract.yaml` (Courts) and `Tally_Contract_Arbitration.yaml`, which differ only in the
`Disputes_*.yaml` clause they include. The contract is fixed for the life of a tally; what changes
(chits, credit terms, trading variables) is recorded on the tally under it.
Still a draft under review; nothing is published.

## Working on the documents

Stroc's guides: [Authoring](https://github.com/gotchoices/stroc/blob/main/docs/Authoring.md),
[Deploying](https://github.com/gotchoices/stroc/blob/main/docs/Deploying.md). The `stroc` command
is the repo's `@stroc/cli` dev dependency: run it as `yarn stroc` from anywhere in the repo
(`publish.sh` does; set `STROC` to use another build).

```
yarn contracts:serve                  # from the repo root: index, catalog and editor at http://localhost:3000
./draft.sh serve . --editor --watch   # the same, from this folder (see below)
yarn stroc lint *.yaml
yarn stroc status .                   # each document's CID, and whether every include is current
yarn stroc update . --all             # after editing a clause: re-point the documents that include it
yarn stroc render Tally_Contract.yaml -o tally.pdf
```

An include may be written as a file link (`source: {/: ./Ethics.yaml}`); `yarn stroc link .`
replaces it with the file's CID (`publish.sh` does this; until then see `draft.sh` below).

Every document sereus.org issues says `author: sereus.org`. `stroc status` and `stroc update` keep
`.stroc-record.json` and `.stroc-archive/` (every recorded version's exact bytes): commit both, and
never delete from the archive once a version has been published.

**Until the first publish, do not commit `.stroc-record.json` or `.stroc-archive/`.** Only
`stroc link`, `stroc status` and `stroc update` write them (`lint`, `cid`, `render` and `serve` do
not), and before anything is published they would only preserve draft bytes nobody signed. So
while drafting, the committed documents keep their includes as file links
(`source: {/: ./Ethics.yaml}`), which also means an edited clause is never referenced by a stale
CID. Run stroc through `draft.sh`, which links, runs the command, and on exit restores the file
links and removes the record:

```
./draft.sh serve . --editor --watch     # or, from the repo root: yarn contracts:serve
./draft.sh lint *.yaml
./draft.sh render Tally_Contract.yaml -o tally.pdf
```

`publish.sh` runs `stroc status`, which creates them for real at the first publish; commit them
from then on, and never delete from the archive once a version has been published.

## Publishing

```
./publish.sh --dry-run              # what would be copied to the host
./publish.sh                        # root@gotchoices.org:/var/www/sereus.org
```

Static files, no Stroc server on the host (Stroc 0.2's `stroc export`). The script refuses to
publish an invalid document or an outdated include, records every current version
(`.stroc-record.json`, `.stroc-archive/`), exports the set, and copies only two trees into
sereus.org's Apache document root, never deleting anything there:

```
/var/www/sereus.org/
  ipfs/<cid>                 # each document's bytes, current and archived; never removed
  ipfs/<cid>.html            # its readable page (browsers get it via the exported .htaccess)
  ipfs/.htaccess             # headers + the Accept: text/html rewrite, rewritten each publish
  .well-known/stroc/catalog.json   # which CIDs sereus.org issues, and their status
  .well-known/stroc/.htaccess
```

**After the first publish, commit `.stroc-record.json` and `.stroc-archive/`** and keep committing
them: the catalog marks a version `superseded` only because the archive still holds it, and
`draft.sh` switches off its link/unlink behaviour once the record is tracked. Withdrawing or
endorsing a document is done in this folder's `.stroc.yaml` (`withdrawn`, `endorse`) and
published like any other change.

**One catalog per domain.** Authorship is confirmed from the domain alone, so sereus.org has one
`catalog.json` for every Sereus app, and whichever app exports last writes it. Today Taleus is the
only publisher. When a second app publishes documents for sereus.org, the export has to run over
the union of both sets (one folder holding every app's documents and archive, or one repo that
owns the catalog); the `ipfs/` files themselves never conflict, being named by content.

## Apache

sereus.org is served by Apache from `/var/www/sereus.org`. The exported `.htaccess` files need
`mod_headers`, `mod_rewrite` (both enabled on gotchoices.org) and `AllowOverride FileInfo`, which
the default `/var/www` block does not grant (`AllowOverride None`). Add to the sereus.org SSL
`<VirtualHost>`:

```apache
<Directory /var/www/sereus.org/ipfs>
	AllowOverride FileInfo
</Directory>
<Directory /var/www/sereus.org/.well-known/stroc>
	AllowOverride FileInfo
</Directory>
```

then `apachectl configtest && systemctl reload apache2`. Without it the files are still served and
the app still works (it fetches `?format=raw` and verifies by CID), but browser-based clients lack
`Access-Control-Allow-Origin: *`, the raw files get a guessed content type, and a browser opening
`/ipfs/<cid>` gets bytes instead of the page.

Running the Stroc server instead (Docker, proxied under the same two paths) remains possible; see
Stroc's [Deploying](https://github.com/gotchoices/stroc/blob/main/docs/Deploying.md).

Verify:

```
curl -sI https://sereus.org/.well-known/stroc/catalog.json | grep -i -e '^HTTP' -e access-control
curl -s https://sereus.org/.well-known/stroc/catalog.json | head
curl -s 'https://sereus.org/ipfs/<contract-cid>?format=raw' | head -c 200
```
