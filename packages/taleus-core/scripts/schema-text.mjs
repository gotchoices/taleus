// Emit each `schema/<name>.qsql` as `dist/schema-text/<name>.js` (with its `.d.ts`), exporting
// the schema's text as the module's default. A host that cannot read files at run time -- React
// Native, a browser bundle -- imports `taleus-core/schema-text/<name>` and needs no bundler
// support for `.qsql`. Node hosts can still read the file (`taleus-core/schema/<name>.qsql`).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const from = path.join(root, 'schema')
const to = path.join(root, 'dist', 'schema-text')

mkdirSync(to, { recursive: true })
for (const file of readdirSync(from).filter(name => name.endsWith('.qsql'))) {
	const name = path.basename(file, '.qsql')
	const text = readFileSync(path.join(from, file), 'utf8')
	writeFileSync(path.join(to, `${name}.js`), `// Generated from schema/${file} by scripts/schema-text.mjs.\nexport default ${JSON.stringify(text)}\n`)
	writeFileSync(path.join(to, `${name}.d.ts`), `/** The text of schema/${file}. */\ndeclare const schema: string\nexport default schema\n`)
}
