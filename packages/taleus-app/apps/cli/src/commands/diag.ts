/** Diagnostics, which only read: `strands`, `sql`; and `idle`, which keeps the party running. */
import { need, usage, type Command } from './command.ts'
import { untilAborted } from './tallies.ts'

const strands: Command = {
	name: 'strands',
	noArgs: true,
	summary: 'Each tally\'s strand on this node: its status and connections',
	usage: '',
	run(session) {
		const running = [...session.party.node.getStrands().values()]
		session.out.rows(['row', 'tally', 'status', 'connections'], running.map((strand, i) => ({
			row: i + 1,
			tally: strand.strandId,
			status: strand.status,
			connections: strand.libp2pNode?.getConnections().map(connection => connection.remotePeer.toString()).join(' '),
		})))
		return Promise.resolve()
	},
}

const sql: Command = {
	name: 'sql',
	summary: 'Read a tally\'s strand database: sql 2 "select * from App.TallyCore"',
	usage: '<tally> <query>',
	async run(session, args) {
		const { id } = await session.tally(need(sql, args, 0, 'tally'))
		const query = need(sql, args, 1, 'query')
		const database = session.party.node.getStrand(id)?.database
		if (!database) throw new Error(`the strand of ${id} has no database on this node (still syncing?)`)
		for await (const row of database.getDatabase().eval(query)) session.out.json(row)
	},
}

const idle: Command = {
	name: 'idle',
	summary: 'Keep the party running -- reachable, syncing, acting -- for <seconds>, or until Ctrl-C',
	usage: '[<seconds>]',
	async run(session, args) {
		const seconds = args[0] === undefined ? undefined : usage(idle, () => {
			const n = Number(args[0])
			if (!Number.isFinite(n) || n <= 0) throw new Error('takes a number of seconds')
			return n
		})
		session.out.note(seconds ? `idle for ${seconds} s; Ctrl-C to stop sooner` : 'idle; Ctrl-C to stop')
		const timer = seconds ? new AbortController() : undefined
		const timeout = seconds ? setTimeout(() => timer?.abort(), seconds * 1000) : undefined
		try {
			await Promise.race([untilAborted(session.signal), ...(timer ? [untilAborted(timer.signal)] : [])])
		} finally {
			clearTimeout(timeout)
		}
	},
}

export const diagCommands = [strands, sql, idle]
