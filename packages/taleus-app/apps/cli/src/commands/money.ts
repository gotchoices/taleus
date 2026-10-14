/** Moving value: `pay`, `request`, `requests`. */
import { randomUUID } from 'node:crypto'

import { formatAmount, parseAmount } from '../amount.ts'
import { need, usage, type Command } from './command.ts'

const pay: Command = {
	name: 'pay',
	summary: 'Record value given to the partner on a tally: pay 2 12.50 lunch',
	usage: '<tally> <amount> [<memo...>]',
	async run(session, args) {
		const { id, unit } = await session.tally(need(pay, args, 0, 'tally'))
		const amount = usage(pay, () => parseAmount(need(pay, args, 1, 'amount'), unit))
		const memo = args.slice(2).join(' ').trim()
		// One act id per command: the model makes a retried act safe by it.
		const entry = session.unwrap(await session.party.model.entries.recordEntry(id, { actId: `act:${randomUUID()}`, amount, ...(memo ? { memo } : {}) }))
		session.out.rows(['id', 'date', 'issuer', 'amount', 'balanceAfter', 'memo'], [{
			id: entry.id,
			date: entry.date,
			issuer: entry.issuer,
			amount: formatAmount(entry.amount.units, unit),
			balanceAfter: `${formatAmount(entry.balanceAfter.units, unit)} ${entry.balanceAfter.perspective}`,
			memo: entry.memo,
		}])
	},
}

const REQUEST_COLUMNS = ['row', 'id', 'tally', 'direction', 'amount', 'stillAsked', 'state', 'memo'] as const

const request: Command = {
	name: 'request',
	summary: 'Ask the partner on a tally to pay: request 2 40 "March hours"',
	usage: '<tally> <amount> [<memo...>]',
	async run(session, args) {
		const { id, unit } = await session.tally(need(request, args, 0, 'tally'))
		const amount = usage(request, () => parseAmount(need(request, args, 1, 'amount'), unit))
		const memo = args.slice(2).join(' ').trim()
		const made = session.unwrap(await session.party.model.requests.createRequest(id, { amount, ...(memo ? { memo } : {}) }))
		session.out.rows(REQUEST_COLUMNS, [{
			id: made.id,
			tally: made.tallyId,
			direction: made.direction,
			amount: formatAmount(made.amount.units, unit),
			stillAsked: formatAmount(made.stillAsked.units, unit),
			state: made.state,
			memo: made.memo,
		}])
	},
}

const requests: Command = {
	name: 'requests',
	summary: 'Requests to pay, on one tally or all',
	usage: '[<tally>]',
	async run(session, args) {
		const tallies = await session.tallies()
		const only = args[0] === undefined ? undefined : await session.tally(args[0])
		const list = session.unwrap(await session.party.model.requests.listRequests(only?.id))
		const unitOf = (tallyId: string) => tallies.find(tally => tally.id === tallyId)?.unit
		session.out.rows(REQUEST_COLUMNS, list.map((item, i) => {
			const unit = unitOf(item.tallyId)
			const money = (units: number) => (unit ? formatAmount(units, unit) : String(units))
			return {
				row: i + 1,
				id: item.id,
				tally: item.tallyId,
				direction: item.direction,
				amount: money(item.amount.units),
				stillAsked: money(item.stillAsked.units),
				state: item.state,
				memo: item.memo,
			}
		}))
	},
}

export const moneyCommands = [pay, request, requests]
