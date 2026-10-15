// Who retains nodes named <target>: retainer name + edge name, counted.
const fs = require('fs')
const [file, target] = process.argv.slice(2)
const s = JSON.parse(fs.readFileSync(file, 'utf8'))
const m = s.snapshot.meta, nf = m.node_fields, ef = m.edge_fields, ntypes = m.node_types[0], etypes = m.edge_types[0]
const N = nf.length, E = ef.length, iN = nf.indexOf('name'), iEC = nf.indexOf('edge_count'), iT = nf.indexOf('type')
const eT = ef.indexOf('type'), eName = ef.indexOf('name_or_index'), eTo = ef.indexOf('to_node')
const by = new Map()
let e = 0
for (let i = 0; i < s.nodes.length; i += N) {
	const count = s.nodes[i + iEC]
	for (let k = 0; k < count; k++, e += E) {
		const to = s.edges[e + eTo]
		if (s.strings[s.nodes[to + iN]] !== target) continue
		const et = etypes[s.edges[e + eT]]
		const en = et === 'element' || et === 'hidden' ? `[${et}]` : s.strings[s.edges[e + eName]]
		const key = `${ntypes[s.nodes[i + iT]]}:${s.strings[s.nodes[i + iN]].slice(0, 70)} .${en}`
		by.set(key, (by.get(key) ?? 0) + 1)
	}
}
for (const [k, c] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(String(c).padStart(7), k)
