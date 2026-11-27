/**
 * The replay **transport + panel** — the one browser-only module of the replay tier. It drives the pure
 * `clock.ts` → `timeline.ts` → `paint.ts` → {@link GraphView} pipeline off a `requestAnimationFrame` loop and
 * builds the panel UI (play/pause, speed, scrub, session picker, colour-by-session, the found-routes list). It
 * touches `document` and `rAF`, so — like the renderer — its gate is `vite build` + a manual check, not jest;
 * every piece of *logic* it calls (the clock math, the active-set reducer, the overlay builder, the found-state
 * classifier) is pure and tested elsewhere.
 *
 * ── One seek path ──────────────────────────────────────────────────────────────────────────────────
 * Playing and scrubbing share exactly one definition of "where the head is": each frame the clock advances the
 * head; a scrub sets it directly; either way the new time flows through {@link renderFrame}, which re-derives
 * the active set and repaints. Because the reducer recomputes from scratch, scrubbing backward is as correct as
 * playing forward — there is no incremental cursor to rewind.
 *
 * ── The trace-format found-route gap (honoured here) ───────────────────────────────────────────────
 * A recorded trace does **not** carry found-plan paths (the `plan-found` event is path-less), so for a loaded
 * trace this panel shows the `plan-found` **markers** (finder node + time + count) and the honest
 * {@link SessionFoundState}, but it cannot draw the exact winning route. The full found-routes list (length +
 * per-link terms, isolate-on-select) lights up only when a {@link ReplayRouteSource} supplies the link-nonce
 * paths — the live-run source (a later ticket) or a test. See `routes.ts` and `docs/design.md` § Replay tier.
 *
 * ── Consensus phase (v2 trace) ─────────────────────────────────────────────────────────────────────
 * When the loaded trace is a consensus run, each session that settled carries a lift in the header
 * (`index.liftFor`). Its {@link Timeline} is bound to that lift, so the active set gains a settlement state and
 * the overlay animates the sign-and-settle phase (promises light the route, the vote previews, commit turns it
 * solid or void flashes then clears). The found-routes side list then shows the lift's **chosen route** — read
 * straight from the header, so this is *exact*, unlike the discovery gap above — with an outcome badge
 * (committed / voided / **unsettled** for a stalled lift); selecting it isolates the route. Below the route it
 * renders the voter-model summary: participant voters (id + vote), a stacked count of off-route referee voters
 * the format cannot place, and the pull-recovered / equivocating / contradiction-detecting members. See
 * `docs/design.md` § Consensus phase.
 */

import type { TraceQueryEntry } from 'tallysim'
import type { CompiledConditions } from 'tallysim'
import { createLiftResolver, type TraceIndex } from '../core/trace-index.js'
import type { Deanonymiser } from '../core/deanonymise.js'
import {
	createTimeline,
	initialPlaybackState,
	pause,
	play,
	seek,
	setSpeed,
	type ConsensusBinding,
	type PlaybackState,
	type Timeline,
} from '../core/timeline.js'
import { advanceClock, progressFraction, timeAtFraction, type TimeBounds } from './clock.js'
import { buildOverlay, mergeOverlays, type IsolatedRoute, type ReplayOverlay } from './paint.js'
import {
	liftIsolate,
	liftOutcome,
	liftRoute,
	liftVoterSummary,
	reconstructRoute,
	routeEdgeTallies,
	sessionFoundState,
	type LiftOutcome,
	type LiftRoute,
	type LiftVoterSummary,
	type RouteInput,
	type SessionFoundState,
} from './routes.js'
import type { TraceLiftEntry } from 'tallysim'
import type { GraphView } from '../graph/render.js'
import type { Palette } from '../app/theme.js'

/** The replay panel handle: re-theme it, or tear it down (stops the rAF loop and clears the overlay). */
export interface ReplayControls {
	/** Re-theme the overlay + panel to a new palette (the shell calls this on a theme toggle). */
	setPalette(palette: Palette): void
	/** Stop the rAF loop, clear the graph overlay, and remove the panel DOM. Idempotent. */
	destroy(): void
}

/**
 * Supplies the link-nonce paths of a session's found plans — the data a recorded trace lacks. The live-run
 * source (a later ticket) implements this from `QueryOutcome.plans[i].path`; a test can hand one in. When
 * absent, the panel shows markers only (see the module header).
 */
export interface ReplayRouteSource {
	routesForSession(sessionCode: string): readonly RouteInput[] | undefined
}

/** The speed multipliers the picker offers (event-time advances this many units per real millisecond). */
const SPEED_STEPS = [0.25, 0.5, 1, 2, 4, 8] as const

/** The scrub bar's integer resolution (fraction `0..1` mapped onto `0..SCRUB_TICKS`). */
const SCRUB_TICKS = 1000

/**
 * Distinct per-session hues for the colour-by-session overlay — the data-viz categorical set, mid-tone so each
 * reads on both the light and dark surfaces. Sessions past the list length wrap (rare: traces hold few queries).
 */
const SESSION_HUES = ['#257de0', '#f47230', '#00b894', '#f2a600', '#ee7fac', '#008a17', '#6a4ce2', '#ec4647'] as const

/** A built-but-inert replay panel for the no-trace / sample path: the controls, visibly disabled, + a hint. */
export function mountDisabledReplayControls(host: HTMLElement): ReplayControls {
	host.textContent = ''
	const wrap = document.createElement('div')
	wrap.className = 'tsv-replay tsv-replay-disabled'
	const row = transportRow()
	row.play.disabled = true
	row.speed.disabled = true
	row.scrub.disabled = true
	const hint = document.createElement('div')
	hint.className = 'tsv-replay-hint'
	hint.textContent = 'Load a trace file to replay a payment search.'
	wrap.append(row.container, hint)
	host.append(wrap)
	return { setPalette(): void {}, destroy(): void { wrap.remove() } }
}

/** The transport row DOM (play/pause button, speed select, scrub range, time readout), not yet wired. */
function transportRow(): {
	container: HTMLDivElement
	play: HTMLButtonElement
	speed: HTMLSelectElement
	scrub: HTMLInputElement
	time: HTMLSpanElement
} {
	const container = document.createElement('div')
	container.className = 'tsv-transport'

	const play = document.createElement('button')
	play.className = 'tsv-replay-play'
	play.textContent = 'Play'

	const speed = document.createElement('select')
	speed.className = 'tsv-replay-speed'
	for (const step of SPEED_STEPS) {
		const option = document.createElement('option')
		option.value = String(step)
		option.textContent = `${step}×`
		if (step === 1) {
			option.selected = true
		}
		speed.append(option)
	}

	const scrub = document.createElement('input')
	scrub.type = 'range'
	scrub.className = 'tsv-replay-scrub'
	scrub.min = '0'
	scrub.max = String(SCRUB_TICKS)
	scrub.step = '1'
	scrub.value = '0'

	const time = document.createElement('span')
	time.className = 'tsv-replay-time'
	time.textContent = 't = 0'

	container.append(play, speed, scrub, time)
	return { container, play, speed, scrub, time }
}

/**
 * Mount the live replay panel for a loaded trace into `host`, wired to `view`. Builds one {@link Timeline} per
 * session (decoding nonces via `deanon`), derives the sleeping/late marks from the compiled `conditions`, and
 * runs the transport. Pass a {@link ReplayRouteSource} to light up the full found-routes list; omit it (the
 * loaded-trace case) for markers only.
 */
export function mountReplayControls(params: {
	host: HTMLElement
	view: GraphView
	index: TraceIndex
	deanon: Deanonymiser
	conditions: CompiledConditions
	palette: Palette
	routeSource?: ReplayRouteSource
	/** When set, auto-play from `t = min` after the initial paint (the live-run source sets it on `done`). */
	autoplay?: boolean
}): ReplayControls {
	const { host, view, index, deanon, conditions, routeSource } = params
	let palette = params.palette

	const sessions = index.sessions()
	const rawBounds = index.timeBounds()
	// No events (or no sessions) ⇒ nothing to replay; fall back to the disabled panel so the UI is consistent.
	if (sessions.length === 0 || rawBounds === undefined) {
		return mountDisabledReplayControls(host)
	}
	// A non-optional alias so the nested rAF/seek closures see a narrowed `TimeBounds`, not `… | undefined`.
	const bounds: TimeBounds = rawBounds

	const timelines = new Map<string, Timeline>()
	for (const session of sessions) {
		// A consensus trace carries one lift per settled session; bind it so the timeline animates settlement.
		// A discovery-only / v1 trace has no lift here, so the binding is omitted and the timeline is unchanged.
		const lift = index.liftFor(session.sessionCode)
		const consensus: ConsensusBinding | undefined = lift !== undefined ? { lift, resolver: createLiftResolver(lift) } : undefined
		timelines.set(
			session.sessionCode,
			createTimeline({
				sessionCode: session.sessionCode,
				events: index.eventsForSession(session.sessionCode),
				resolveTally: (nonce) => deanon.tallyOfNonce(session.sessionCode, nonce),
				consensus,
			}),
		)
	}

	let playback: PlaybackState = initialPlaybackState(bounds.min)
	let selected = sessions[0].sessionCode
	let colourBySession = false
	let isolatedRoute: number | undefined
	let liftIsolated = false
	let rafId: number | undefined
	let lastTs: number | undefined
	let lastFoundSignature = ''

	// ── DOM ──
	host.textContent = ''
	const wrap = document.createElement('div')
	wrap.className = 'tsv-replay'
	const transport = transportRow()
	const picker = sessionPicker(sessions)
	const found = document.createElement('div')
	found.className = 'tsv-replay-found'
	wrap.append(transport.container, picker.container, found)
	host.append(wrap)

	function timelineFor(code: string): Timeline {
		// Every session code in `sessions` was put in the map above, so this is always defined.
		return timelines.get(code) as Timeline
	}

	/** The end of the selected session's own events (its search is complete once the head passes this). */
	function sessionEnd(code: string): number {
		const times = timelineFor(code).eventTimes()
		return times.length === 0 ? bounds.min : times[times.length - 1]
	}

	/** The isolated route for the selected session, resolved to node ids + tally indices, or `undefined`. */
	function currentIsolate(): IsolatedRoute | undefined {
		if (colourBySession) {
			return undefined
		}
		// A settled lift's route isolates straight from the header — exact nodes + tallies, no de-anonymisation.
		if (liftIsolated) {
			const lift = index.liftFor(selected)
			return lift !== undefined ? liftIsolate(lift) : undefined
		}
		// Otherwise the discovery found-plan isolate (needs a route source + de-anonymisation).
		if (isolatedRoute === undefined) {
			return undefined
		}
		const inputs = routeSource?.routesForSession(selected)
		if (inputs === undefined || isolatedRoute >= inputs.length) {
			return undefined
		}
		const input = inputs[isolatedRoute]
		const route = reconstructRoute(deanon, selected, input)
		if (route.kind !== 'path' && route.kind !== 'loop') {
			return undefined
		}
		const tallies = routeEdgeTallies(deanon, selected, input)
		return tallies === undefined ? undefined : { nodes: route.nodes, tallies }
	}

	/** Build the overlay for the current time, honouring colour-by-session and any isolate. */
	function computeOverlay(): ReplayOverlay {
		const time = playback.currentTime
		if (colourBySession) {
			const overlays = sessions.map((session, i) => {
				const active = timelineFor(session.sessionCode).deriveActiveSet(time)
				return buildOverlay({
					active,
					sleeping: conditions.sleeping,
					late: conditions.late,
					palette,
					sessionColor: SESSION_HUES[i % SESSION_HUES.length],
					// A consensus trace animates each session's settlement over its own session hue.
					consensus: active.consensus,
					currentTime: time,
				})
			})
			return mergeOverlays(overlays)
		}
		const active = timelineFor(selected).deriveActiveSet(time)
		return buildOverlay({
			active,
			sleeping: conditions.sleeping,
			late: conditions.late,
			palette,
			isolate: currentIsolate(),
			// `active.consensus` is present only when the selected session has a bound lift; buildOverlay
			// suppresses it in isolate mode anyway.
			consensus: active.consensus,
			currentTime: time,
		})
	}

	/** Repaint the graph overlay and refresh the transport readout + found panel for the current time. */
	function renderFrame(): void {
		// NOTE: the selected session's active set is derived twice per frame — once in computeOverlay and once
		// in refreshFound — i.e. O(events) ×2 per frame. Fine for planned trace sizes; if a large trace ever
		// makes play stutter, derive the selected set once here and thread it into both.
		view.setReplayOverlay(computeOverlay())
		transport.scrub.value = String(Math.round(progressFraction(playback.currentTime, bounds) * SCRUB_TICKS))
		transport.time.textContent = `t = ${Math.round(playback.currentTime)} / ${Math.round(bounds.max)}`
		refreshFound()
	}

	/** The selected session's found state + list; rebuilt only when its signature changes (not every frame). */
	function refreshFound(): void {
		const active = timelineFor(selected).deriveActiveSet(playback.currentTime)
		const atEnd = playback.currentTime >= sessionEnd(selected)
		const state = sessionFoundState({ loaded: true, atEnd, foundCount: active.foundPlans.length })
		const inputs = routeSource?.routesForSession(selected)
		// A consensus trace: the selected session's settled lift (its chosen route + outcome badge, isolatable).
		const lift = index.liftFor(selected)
		// The outcome and voter summary are the lift's FINAL state — derived at the end of its own events (both are
		// stable regardless of the current head). One derivation feeds both.
		// NOTE: derives the selected session's active set a third time per rebuild (on top of the twice-per-frame
		// NOTE at renderFrame). Fine for planned trace sizes; if a large trace stutters, derive once and thread.
		const finalConsensus = lift !== undefined ? timelineFor(selected).deriveActiveSet(sessionEnd(selected)).consensus : undefined
		const outcome: LiftOutcome | undefined = lift !== undefined ? liftOutcome(finalConsensus?.decision) : undefined
		const voterSummary = finalConsensus !== undefined ? liftVoterSummary(finalConsensus) : undefined
		const signature = [
			selected,
			state.kind,
			active.foundPlans.length,
			isolatedRoute ?? -1,
			liftIsolated,
			inputs === undefined,
			lift !== undefined,
			outcome ?? '',
			voterSummaryFingerprint(voterSummary),
		].join('|')
		if (signature === lastFoundSignature) {
			return
		}
		lastFoundSignature = signature
		renderFound(found, {
			state,
			markers: active.foundPlans,
			inputs,
			selected,
			lift,
			outcome,
			voterSummary,
		})
	}

	/**
	 * Render the found-state label and then one of: the settled lift's route (consensus trace), the full
	 * routes list (a route source), or the markers-only view (a loaded discovery trace).
	 */
	function renderFound(
		container: HTMLElement,
		info: {
			state: SessionFoundState
			markers: readonly { time: number; node: number }[]
			inputs: readonly RouteInput[] | undefined
			selected: string
			lift: TraceLiftEntry | undefined
			outcome: LiftOutcome | undefined
			voterSummary: LiftVoterSummary | undefined
		},
	): void {
		container.textContent = ''
		const label = document.createElement('div')
		label.className = 'tsv-replay-found-state'
		label.textContent = foundStateLabel(info.state)
		container.append(label)

		// Consensus trace: the chosen lift route (exact, from the header) with an outcome badge; click isolates it.
		if (info.lift !== undefined) {
			renderLiftRoute(container, info.lift, info.outcome ?? 'stalled', info.markers.length, info.voterSummary)
			return
		}
		if (info.inputs !== undefined) {
			renderRouteList(container, info.inputs, info.selected)
			return
		}
		// Loaded-trace path: no plan paths in the format — markers + an honest note, never a faked route.
		if (info.markers.length > 0) {
			const list = document.createElement('ul')
			list.className = 'tsv-replay-markers'
			for (const marker of info.markers) {
				const item = document.createElement('li')
				item.textContent = `found at entity ${marker.node} (t = ${Math.round(marker.time)})`
				list.append(item)
			}
			container.append(list)
		}
		const note = document.createElement('div')
		note.className = 'tsv-replay-note'
		note.textContent = 'Exact route path is not recorded in the trace format — showing finder and time only.'
		container.append(note)
	}

	/** Render the full found-routes list (length + per-link terms); clicking an item isolates it. */
	function renderRouteList(container: HTMLElement, inputs: readonly RouteInput[], code: string): void {
		const list = document.createElement('ul')
		list.className = 'tsv-replay-routes'
		inputs.forEach((input, i) => {
			const route = reconstructRoute(deanon, code, input)
			const item = document.createElement('li')
			const button = document.createElement('button')
			button.className = 'tsv-replay-route'
			button.textContent = routeLabel(route, i)
			if (i === isolatedRoute) {
				button.classList.add('tsv-replay-route-active')
			}
			button.addEventListener('click', () => {
				isolatedRoute = isolatedRoute === i ? undefined : i
				lastFoundSignature = '' // force the active-state class to repaint
				renderFrame()
			})
			item.append(button)
			list.append(item)
		})
		container.append(list)
	}

	/**
	 * Render the settled lift's single route item — its hop count + outcome badge — read straight from the
	 * header (exact, no decode). Clicking it toggles isolate (dim the rest), like the discovery route list. Any
	 * other discovery plans beyond the one that settled stay markers-only (the format carries no path for them).
	 */
	function renderLiftRoute(
		container: HTMLElement,
		lift: TraceLiftEntry,
		outcome: LiftOutcome,
		markerCount: number,
		voterSummary: LiftVoterSummary | undefined,
	): void {
		const list = document.createElement('ul')
		list.className = 'tsv-replay-routes'
		const route = liftRoute(lift)
		const item = document.createElement('li')
		const button = document.createElement('button')
		button.className = 'tsv-replay-route tsv-replay-lift'
		button.textContent = liftRouteLabel(route, outcome)
		if (liftIsolated) {
			button.classList.add('tsv-replay-route-active')
		}
		button.addEventListener('click', () => {
			liftIsolated = !liftIsolated
			lastFoundSignature = '' // force the active-state class to repaint
			renderFrame()
		})
		item.append(button)
		list.append(item)
		container.append(list)
		if (voterSummary !== undefined) {
			renderVoterSummary(container, voterSummary)
		}
		// Discovery may find several plans while only one settles into this lift; the rest have no recorded path.
		if (markerCount > 1) {
			const note = document.createElement('div')
			note.className = 'tsv-replay-note'
			note.textContent = `${markerCount - 1} other discovery plan${markerCount - 1 === 1 ? '' : 's'} found — markers only (exact path not recorded).`
			container.append(note)
		}
	}

	/**
	 * Render the voter-model breakdown below the lift route: the participant voters (id + vote), a stacked count
	 * of off-route referee voters the trace format cannot place, and the pull-recovered / equivocating /
	 * contradiction-detecting members. Everything here is text, so colour (the graph accents) is never the sole
	 * channel for a member's state.
	 */
	function renderVoterSummary(container: HTMLElement, summary: LiftVoterSummary): void {
		const box = document.createElement('div')
		box.className = 'tsv-replay-voters'
		if (summary.participants.length > 0) {
			const ul = document.createElement('ul')
			ul.className = 'tsv-replay-voter-list'
			for (const voter of summary.participants) {
				const li = document.createElement('li')
				li.textContent = `voter ${voter.node}${voter.vote === undefined ? '' : ` — ${voteWord(voter.vote)}`}`
				ul.append(li)
			}
			box.append(ul)
		}
		if (summary.refereeOnlyCount > 0) {
			// The format carries no place for off-route referees (see the design doc's gap) — counted, not drawn.
			box.append(voterLine(`+${summary.refereeOnlyCount} referee-only voter${summary.refereeOnlyCount === 1 ? '' : 's'} (stacked)`))
		}
		if (summary.pulled.length > 0) {
			box.append(voterLine(`recovered by pull: ${summary.pulled.join(', ')}`))
		}
		if (summary.equivocators.length > 0) {
			box.append(voterLine(`equivocated (emitted both faces): ${summary.equivocators.join(', ')}`))
		}
		if (summary.contradictions.length > 0) {
			box.append(voterLine(`contradiction detected: ${summary.contradictions.join(', ')}`))
		}
		container.append(box)
	}

	// ── Transport wiring ──
	function setPlaying(playing: boolean): void {
		playback = playing ? play(playback) : pause(playback)
		transport.play.textContent = playing ? 'Pause' : 'Play'
		if (playing) {
			startLoop()
		} else {
			stopLoop()
		}
	}

	function startLoop(): void {
		if (rafId !== undefined) {
			return
		}
		lastTs = undefined
		const tick = (ts: number): void => {
			if (!playback.playing) {
				rafId = undefined
				return
			}
			const delta = lastTs === undefined ? 0 : ts - lastTs
			lastTs = ts
			const step = advanceClock(playback.currentTime, playback.speed, delta, bounds)
			playback = seek(playback, step.time)
			renderFrame()
			if (step.atEnd) {
				setPlaying(false) // reached the end: auto-pause (this also clears rafId via stopLoop)
				return
			}
			rafId = requestAnimationFrame(tick)
		}
		rafId = requestAnimationFrame(tick)
	}

	function stopLoop(): void {
		if (rafId !== undefined) {
			cancelAnimationFrame(rafId)
			rafId = undefined
		}
	}

	transport.play.addEventListener('click', () => {
		setPlaying(!playback.playing)
	})
	transport.speed.addEventListener('change', () => {
		playback = setSpeed(playback, Number(transport.speed.value))
	})
	transport.scrub.addEventListener('input', () => {
		setPlaying(false) // scrubbing pauses; the user drives the head directly
		const fraction = Number(transport.scrub.value) / SCRUB_TICKS
		playback = seek(playback, timeAtFraction(fraction, bounds))
		renderFrame()
	})
	picker.select.addEventListener('change', () => {
		selected = picker.select.value
		isolatedRoute = undefined
		liftIsolated = false
		lastFoundSignature = ''
		renderFrame()
	})
	picker.colour.addEventListener('change', () => {
		colourBySession = picker.colour.checked
		picker.select.disabled = colourBySession
		isolatedRoute = undefined
		liftIsolated = false
		lastFoundSignature = ''
		renderFrame()
	})

	renderFrame() // initial paint at t = min (clean empty)
	if (params.autoplay === true) {
		// A finished live run plays itself from t = min (the file-load path leaves it paused).
		setPlaying(true)
	}

	return {
		setPalette(next: Palette): void {
			palette = next
			renderFrame()
		},
		destroy(): void {
			stopLoop()
			view.setReplayOverlay(undefined)
			wrap.remove()
		},
	}
}

/** The session picker DOM: a `<select>` of sessions + a colour-by-session checkbox. */
function sessionPicker(sessions: readonly TraceQueryEntry[]): {
	container: HTMLDivElement
	select: HTMLSelectElement
	colour: HTMLInputElement
} {
	const container = document.createElement('div')
	container.className = 'tsv-replay-sessions'

	const select = document.createElement('select')
	select.className = 'tsv-replay-session'
	for (const session of sessions) {
		const option = document.createElement('option')
		option.value = session.sessionCode
		option.textContent = `${session.from} → ${session.to} (${session.sessionCode})`
		select.append(option)
	}

	const colourLabel = document.createElement('label')
	colourLabel.className = 'tsv-replay-colour'
	const colour = document.createElement('input')
	colour.type = 'checkbox'
	colourLabel.append(colour, document.createTextNode(' colour by session'))

	container.append(select, colourLabel)
	return { container, select, colour }
}

/** The human label for a session's found state (loading / searching / no route / found N). */
function foundStateLabel(state: SessionFoundState): string {
	switch (state.kind) {
		case 'loading': {
			return 'Loading…'
		}
		case 'searching': {
			return 'Searching…'
		}
		case 'no-route': {
			return 'No route found'
		}
		case 'found': {
			return `Found ${state.count} route${state.count === 1 ? '' : 's'}`
		}
	}
}

/** The label for one reconstructed route item: hop count + the per-link terms (opaque, rendered as JSON). */
function routeLabel(route: ReturnType<typeof reconstructRoute>, index: number): string {
	switch (route.kind) {
		case 'path':
		case 'loop': {
			const kind = route.kind === 'loop' ? 'loop' : 'route'
			const terms = route.terms === undefined ? '' : ` — terms ${summariseTerms(route.terms)}`
			return `${kind} ${index + 1}: ${route.hops} hop${route.hops === 1 ? '' : 's'}${terms}`
		}
		case 'empty': {
			return `route ${index + 1}: (empty)`
		}
		case 'decode-failed': {
			return `route ${index + 1}: (decode failed)`
		}
	}
}

/** The label for the settled lift's route item: `route`/`loop`, hop count, and the outcome badge word. */
function liftRouteLabel(route: LiftRoute, outcome: LiftOutcome): string {
	const kind = route.kind === 'loop' ? 'loop' : 'route'
	return `${kind}: ${route.hops} hop${route.hops === 1 ? '' : 's'} — ${outcomeWord(outcome)}`
}

/** The badge word for an outcome — a `stalled` lift reads as **unsettled** (a tie / no settlement), never a spinner. */
function outcomeWord(outcome: LiftOutcome): string {
	return outcome === 'stalled' ? 'unsettled' : outcome
}

/** The human word for a vote: `C` commit-pending, `NC` no-commit. */
function voteWord(vote: 'C' | 'NC'): string {
	return vote === 'C' ? 'commit' : 'no-commit'
}

/** A plain text line for the voter-summary box. */
function voterLine(text: string): HTMLDivElement {
	const line = document.createElement('div')
	line.className = 'tsv-replay-voter-line'
	line.textContent = text
	return line
}

/** A compact fingerprint of the voter summary so the found panel rebuilds when it changes (it rarely does). */
function voterSummaryFingerprint(summary: LiftVoterSummary | undefined): string {
	if (summary === undefined) {
		return ''
	}
	return [
		summary.participants.map((p) => `${p.node}${p.vote ?? ''}`).join(','),
		summary.refereeOnlyCount,
		summary.pulled.join(','),
		summary.equivocators.join(','),
		summary.contradictions.join(','),
	].join(';')
}

/** Summarise per-link terms opaquely (the viewer must not couple to the lift's term shape). */
function summariseTerms(terms: readonly unknown[]): string {
	try {
		return JSON.stringify(terms)
	} catch {
		return `${terms.length} link(s)`
	}
}
