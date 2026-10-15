// Diff two heap snapshots by constructor/name: count and self size.
const fs = require('fs')
function load(file) {
	const s = JSON.parse(fs.readFileSync(file, 'utf8'))
	const f = s.snapshot.meta.node_fields, types = s.snapshot.meta.node_types[0]
	const n = f.length, iT = f.indexOf('type'), iN = f.indexOf('name'), iS = f.indexOf('self_size')
	const by = new Map()
	let total = 0
	for (let i = 0; i < s.nodes.length; i += n) {
		const type = types[s.nodes[i + iT]]
		const key = `${type}:${type === 'string' || type === 'concatenated string' ? '' : s.strings[s.nodes[i + iN]].slice(0, 60)}`
		const e = by.get(key) ?? { c: 0, b: 0 }
		e.c++; e.b += s.nodes[i + iS]; total += s.nodes[i + iS]
		by.set(key, e)
	}
	return { by, total }
}
const [a, b] = process.argv.slice(2).map(load)
console.log(`total self: ${(a.total / 1048576).toFixed(1)} -> ${(b.total / 1048576).toFixed(1)} MB`)
const rows = [...new Set([...a.by.keys(), ...b.by.keys()])].map(k => {
	const x = a.by.get(k) ?? { c: 0, b: 0 }, y = b.by.get(k) ?? { c: 0, b: 0 }
	return { k, dc: y.c - x.c, db: y.b - x.b, c: y.c, bytes: y.b }
}).sort((p, q) => q.db - p.db)
for (const r of rows.slice(0, 25)) console.log(`${(r.db / 1024).toFixed(0).padStart(8)} KB  ${String(r.dc).padStart(7)} objs  (now ${r.c} / ${(r.bytes / 1024).toFixed(0)} KB)  ${r.k}`)
