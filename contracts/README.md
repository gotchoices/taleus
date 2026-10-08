# Taleus contracts

The tally contract documents sereus.org publishes for Taleus, in [Stroc](https://github.com/gotchoices/stroc)
format. A tally names the contract it is under only by CID (`TallyContractProposal.ContractCid`,
`TallyContract.ContractCid`); the documents themselves are published here and kept by the parties'
apps, not written into the tally.

The current set is the MyCHIPs contract library, converted by Stroc and re-authored to
`sereus.org`. It is a draft: the wording still describes MyCHIPs (CHIPs only, MyCHIPs servers) and
has not been revised for Taleus.

## Working on the documents

Stroc's guides: [Authoring](../../../stroc/docs/Authoring.md), [Deploying](../../../stroc/docs/Deploying.md).
The scripts run `stroc` from `PATH`, or the command in `STROC`. Until the Stroc release:

```
export STROC="node $HOME/share/devel/stroc/packages/cli/dist/src/index.js"
```

```
stroc serve . --editor --watch      # index, catalog and editor at http://localhost:3000
stroc lint *.yaml
stroc status .                      # each document's CID, and whether every include is current
stroc update . --all                # after editing a clause: re-point the documents that include it
stroc render Tally_Contract.yaml -o tally.pdf
```

While drafting, an include may be written as a file link (`source: {/: ./Ethics.yaml}`);
`stroc link .` replaces it with the file's CID.

Every document sereus.org issues says `author: sereus.org`. `stroc status` and `stroc update` keep
`.stroc-record.json` and `.stroc-archive/` (every recorded version's exact bytes): commit both, and
never delete from the archive once a version has been published.

Before the first publish, the archive may hold draft versions nobody signed; deleting
`.stroc-archive/` and `.stroc-record.json` then is harmless. After it, never.

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
