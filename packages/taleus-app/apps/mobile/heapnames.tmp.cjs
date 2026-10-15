const fs = require('fs')
const [file, pattern] = process.argv.slice(2)
const s = JSON.parse(fs.readFileSync(file, 'utf8'))
const f = s.snapshot.meta.node_fields, types = s.snapshot.meta.node_types[0]
const n = f.length, iT = f.indexOf('type'), iN = f.indexOf('name'), iS = f.indexOf('self_size')
const re = new RegExp(pattern, 'i'), by = new Map()
for (let i = 0; i < s.nodes.length; i += n) {
	const name = s.strings[s.nodes[i + iN]]
	if (!re.test(name)) continue
	const key = `${types[s.nodes[i + iT]]}:${name.slice(0, 80)}`
	by.set(key, (by.get(key) ?? 0) + 1)
}
for (const [k, c] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(String(c).padStart(7), k)
