/**
 * Where a process spent its CPU: reads a V8 `.cpuprofile` (`node --cpu-prof`) and prints self time
 * by package and by function, optionally within a window of the profile (seconds from its start).
 * Idle and garbage collection are shown separately, so "busy" and "waiting" are not confused.
 *
 *   node scripts/summarize-cpu.ts <file.cpuprofile> [--from <s>] [--to <s>] [--top <n>]
 */
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const { positionals, values } = parseArgs({ allowPositionals: true, options: { from: { type: 'string' }, to: { type: 'string' }, top: { type: 'string' } } })
const file = positionals[0]
if (!file) {
	process.stderr.write('usage: summarize-cpu.ts <file.cpuprofile> [--from <s>] [--to <s>] [--top <n>]\n')
	process.exit(1)
}

interface CallFrame {
	functionName: string
	url: string
	lineNumber: number
}
interface ProfileNode {
	id: number
	callFrame: CallFrame
}
interface Profile {
	nodes: ProfileNode[]
	startTime: number
	endTime: number
	samples: number[]
	timeDeltas: number[]
}

const profile = JSON.parse(readFileSync(file, 'utf8')) as Profile
const byId = new Map(profile.nodes.map(node => [node.id, node]))
const from = Number(values.from ?? 0) * 1e6
const to = values.to === undefined ? Infinity : Number(values.to) * 1e6
const top = Number(values.top ?? 20)

/** Which package a script belongs to: `@scope/name` or `name` under node_modules, a workspace package, else node itself. */
function packageOf(url: string): string {
	if (!url) return '(native / no script)'
	const modules = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(url)
	if (modules) return modules[1]
	const workspace = /packages\/(taleus-[a-z]+)\//.exec(url)
	if (workspace) return workspace[1]
	if (url.includes('/apps/cli/')) return 'taleus-cli'
	if (url.startsWith('node:')) return 'node:*'
	return url.split('/').slice(-2).join('/')
}

const byPackage = new Map<string, number>()
const byFunction = new Map<string, number>()
let elapsed = 0
let total = 0
for (let i = 0; i < profile.samples.length; i++) {
	elapsed += profile.timeDeltas[i]
	if (elapsed < from || elapsed > to) continue
	const delta = profile.timeDeltas[i + 1] ?? 0
	const node = byId.get(profile.samples[i])
	if (!node) continue
	total += delta
	const { functionName, url, lineNumber } = node.callFrame
	const special = ['(idle)', '(garbage collector)', '(program)'].includes(functionName) ? functionName : undefined
	const pkg = special ?? packageOf(url)
	byPackage.set(pkg, (byPackage.get(pkg) ?? 0) + delta)
	const fn = special ?? `${functionName || '(anonymous)'}  ${pkg}:${url.split('/').pop()}:${lineNumber + 1}`
	byFunction.set(fn, (byFunction.get(fn) ?? 0) + delta)
}

const ms = (us: number) => (us / 1000).toFixed(0).padStart(7)
const pct = (us: number) => `${((us / total) * 100).toFixed(1).padStart(5)}%`
process.stdout.write(`${file}\nwindow ${(from / 1e6).toFixed(1)}-${to === Infinity ? 'end' : (to / 1e6).toFixed(1)} s of ${((profile.endTime - profile.startTime) / 1e6).toFixed(1)} s; ${ms(total)} ms sampled\n\nby package (self time)\n`)
for (const [name, us] of [...byPackage].sort((a, b) => b[1] - a[1]).slice(0, top)) process.stdout.write(`${ms(us)} ms ${pct(us)}  ${name}\n`)
process.stdout.write('\nby function (self time)\n')
for (const [name, us] of [...byFunction].sort((a, b) => b[1] - a[1]).slice(0, top)) process.stdout.write(`${ms(us)} ms ${pct(us)}  ${name}\n`)
