# Taleus contracts

The tally contract documents sereus.org publishes for Taleus, in [Stroc](https://github.com/gotchoices/stroc)
format. A tally names the contract it is under only by CID (`TallyContractProposal.ContractCid`,
`TallyContract.ContractCid`); the documents themselves are published here and kept by the parties'
apps, not written into the tally.

The set is the MyCHIPs contract library (as revised 2024-02-06), converted by Stroc, re-authored
to `sereus.org`, and revised for Taleus: protocol and publisher names, no servers (a tally is one
shared record on both parties' devices), key sets rather than one key, credit terms named as in the
schema, and a new `Denomination.yaml` (Unit of Account) carrying the clauses that used to assume
CHIPs so a tally may be kept in any unit. `CHIP_Definition.yaml` now defines only the CHIP itself.
Still a draft under review; nothing is published.

## Working on the documents

Stroc's guides: [Authoring](https://github.com/gotchoices/stroc/blob/main/docs/Authoring.md),
[Deploying](https://github.com/gotchoices/stroc/blob/main/docs/Deploying.md). The `stroc` command
is the repo's `@stroc/cli` dev dependency: run it as `yarn stroc` from anywhere in the repo
(`publish.sh` does; set `STROC` to use another build).

```
yarn contracts:serve                  # from the repo root: index, catalog and editor at http://localhost:3000
yarn stroc serve . --editor --watch   # the same, from this folder
yarn stroc lint *.yaml
yarn stroc status .                   # each document's CID, and whether every include is current
yarn stroc update . --all             # after editing a clause: re-point the documents that include it
yarn stroc render Tally_Contract.yaml -o tally.pdf
```

While drafting, an include may be written as a file link (`source: {/: ./Ethics.yaml}`);
`yarn stroc link .` replaces it with the file's CID.

Every document sereus.org issues says `author: sereus.org`. `stroc status` and `stroc update` keep
`.stroc-record.json` and `.stroc-archive/` (every recorded version's exact bytes): commit both, and
never delete from the archive once a version has been published.

**Until the first publish, do not commit `.stroc-record.json` or `.stroc-archive/`.** Only
`stroc link`, `stroc status` and `stroc update` write them (`lint`, `cid`, `render` and `serve` do
not), and before anything is published they would only preserve draft bytes nobody signed. While
drafting, run `yarn stroc link .` when includes change, then delete both again:

```
yarn stroc link . && rm -rf .stroc-record.json .stroc-archive
```

`publish.sh` runs `stroc status`, which creates them for real at the first publish; commit them
from then on, and never delete from the archive once a version has been published.

## Publishing

```
./publish.sh --dry-run              # what would change on the host
./publish.sh                        # root@gotchoices.org:/srv/stroc/sereus.org
```

It refuses to publish an invalid document or an outdated include, then uploads into the shared
folder the Stroc server serves for sereus.org:

```
/srv/stroc/sereus.org/
  .stroc.yaml              # the domain's: domain, endorse, withdrawn (edited on the host)
  .stroc-archive/<cid>.json  # every version any app has published, never removed
  taleus.Tally_Contract.yaml # Taleus's current documents, under its prefix
  chat.….yaml                # another app's, under its own
```

sereus.org has **one catalog for every Sereus app**: authorship is confirmed from the domain alone,
so Stroc does not support a set per path (`sereus.org/taleus/...`). Each app publishes into the
same folder with its own file prefix. File names carry no meaning to the server (documents are
found by CID), so the prefix only keeps one app's publish from replacing or removing another's
files. An app that adopts documents copies this script and changes `APP`.

Withdrawing or endorsing a document is a decision for the domain, not one app: edit
`/srv/stroc/sereus.org/.stroc.yaml` on the host and reload. The local `.stroc.yaml` is only for
previewing with `stroc serve`.

## Server

Once, or after a Stroc release: `./server-setup.sh` creates the shared folder and its
`.stroc.yaml`, builds the Stroc server image from a checkout on the host, and runs it as the
container `stroc-server` on `127.0.0.1:3100`. `publish.sh` reloads it with `SIGHUP`.

The front end forwards only Stroc's paths, at the root of the domain:

```nginx
location /ipfs/ { proxy_pass http://127.0.0.1:3100; }
location /.well-known/stroc/ { proxy_pass http://127.0.0.1:3100; }
```

```
sereus.org {
	handle /ipfs/* { reverse_proxy 127.0.0.1:3100 }
	handle /.well-known/stroc/* { reverse_proxy 127.0.0.1:3100 }
}
```

Verify:

```
curl -s https://sereus.org/.well-known/stroc/catalog.json | head
curl -s -H 'Accept: application/vnd.ipld.raw' https://sereus.org/ipfs/<contract-cid> | head -c 200
```
