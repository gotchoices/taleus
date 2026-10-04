/**
 * What the model derives across tallies rather than reads from one: the attention list and the
 * party's position. Neither is stored anywhere -- both are recomputed from the tallies each time.
 */
import type { AttentionItem, AttentionModel, PastItem } from '../attention.js'
import type { PositionModel, PerUnitPosition } from '../position.js'
import { daysSince } from '../types.js'
import type { Session } from './session.js'
import { amount, instantOf, nameOf, ok, requestStateOf } from './translate.js'
import { situationOf } from './tallies.js'

type Waiting = Omit<AttentionItem, 'waitingDays' | 'daysLeft'>

async function waitingItems(session: Session): Promise<{ open: Waiting[]; past: PastItem[] }> {
	const open: Waiting[] = []
	const past: PastItem[] = []
	const today = instantOf(session.today())
	for (const { tally, view } of await session.views()) {
		const unit = session.unitOf(view)
		const counterparty = { name: nameOf(view.counterparty.sid, view.counterparty.certificate) }
		const requests = await tally.requests()
		const situation = situationOf(view, requests)
		const base = { tallyId: view.ref.id, counterparty }

		if (view.state === 'offered' && situation.waitingOn !== 'nobody') {
			open.push({ ...base, id: `offer:${view.ref.id}`, kind: 'offer', waitingOn: situation.waitingOn, waitingSince: today, route: 'ReviewOffer' })
		}
		if (view.state === 'closing' && situation.waitingOn !== 'nobody') {
			open.push({ ...base, id: `closing:${view.ref.id}`, kind: 'closing', waitingOn: situation.waitingOn, waitingSince: today, route: 'TallyView' })
		}
		for (const request of requests) {
			const item = {
				...base,
				id: `request:${request.id}`,
				kind: 'request' as const,
				amount: { ...amount(request.amount.units, unit), denom: unit.denom, scale: unit.scale },
				route: 'RequestView',
				requestId: request.id,
			}
			const state = requestStateOf(request.state)
			if (state === 'waiting') {
				open.push({ ...item, waitingOn: request.from === 'me' ? 'them' : 'me', waitingSince: instantOf(request.requestedOn) })
			} else {
				past.push({ ...item, arrived: instantOf(request.requestedOn), resolved: today, outcome: state })
			}
		}
	}
	return { open, past }
}

export function attentionModel(session: Session): AttentionModel {
	const aside = session.local.setAside

	async function list() {
		const now = session.now().getTime()
		const { open } = await waitingItems(session)
		return ok(
			open
				.filter(item => !aside[item.id])
				.map(item => ({ ...item, waitingDays: daysSince(item.waitingSince, now) })),
		)
	}

	return {
		listAttention: list,

		async listPast() {
			const { open, past } = await waitingItems(session)
			const setAside: PastItem[] = open
				.filter(item => aside[item.id])
				.map(item => ({
					id: item.id,
					kind: item.kind,
					tallyId: item.tallyId,
					counterparty: item.counterparty,
					...(item.amount ? { amount: item.amount } : {}),
					route: item.route,
					...(item.requestId ? { requestId: item.requestId } : {}),
					arrived: item.waitingSince,
					resolved: aside[item.id],
					outcome: 'set-aside' as const,
				}))
			return ok([...setAside, ...past].sort((a, b) => b.resolved.localeCompare(a.resolved)))
		},

		async setAside(id) {
			// Setting aside stays on this device: nothing reaches the other party, and nothing on
			// the tally changes. It is not a refusal.
			aside[id] = session.now().toISOString()
			session.changed()
			return list()
		},

		async bringBack(id) {
			delete aside[id]
			session.changed()
			return list()
		},

		wasSetAside(id) {
			return aside[id] !== undefined
		},
	}
}

export function positionModel(session: Session, displayUnit: () => string): PositionModel {
	return {
		async readPosition() {
			const byDenom = new Map<string, PerUnitPosition>()
			for (const { view } of await session.views()) {
				if (view.state === 'forming') continue
				const unit = session.unitOf(view)
				const row = byDenom.get(unit.denom) ?? { ...unit, owedToMe: amount(0, unit), owedByMe: amount(0, unit) }
				const settled = view.balances.settled.units
				if (settled > 0) row.owedToMe = amount(row.owedToMe.units + settled, unit)
				if (settled < 0) row.owedByMe = amount(row.owedByMe.units - settled, unit)
				byDenom.set(unit.denom, row)
			}
			// No estimate across units: that needs rates, and a single cross-unit total is the
			// figure `feat-position-and-estimates` warns is a lie without them.
			return ok({ displayUnit: displayUnit(), perUnit: [...byDenom.values()], estimate: null, spendingPower: null })
		},
	}
}
