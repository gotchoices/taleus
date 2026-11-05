import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { getGeneration, subscribeGeneration } from '../data/generation'
import type { DataError, Result } from '../data/types'
import { describeThrown } from 'taleus-model'

export type LoadState = 'loading' | 'ready' | 'failed'

export interface Loaded<T> {
	state: LoadState
	value?: T
	/** The last read failed. With a value still shown (`ready`), the value is the last good one. */
	error?: DataError
	/** A re-read is under way behind the value shown. */
	refreshing: boolean
	reload(): void
}

/**
 * The load state machine, once.
 *
 * Every data-backed screen had its own copy — three `useState`s, a `useCallback`
 * with a try/catch, a `useEffect`, three early returns — and three of the five
 * copies dropped `result.error` on the floor, which lost both the message and
 * the adapter's word on whether retrying could help. Keeping it here means the
 * next twenty-five screens inherit the fix rather than the bug.
 *
 * A release build swallows unhandled rejections silently, so the catch is not
 * decoration: without it a throw shows as a spinner that never resolves.
 *
 * Only the first read shows `loading`. A re-read -- every commit asks for one -- keeps the last
 * value on screen until a newer one arrives, and a re-read that fails keeps it too, with the error
 * beside it: a screen never blanks for a read it already answered.
 */
export function useLoad<T>(load: () => Promise<Result<T>>): Loaded<T> {
	const [state, setState] = useState<LoadState>('loading')
	const [value, setValue] = useState<T | undefined>()
	const [error, setError] = useState<DataError | undefined>()
	const [refreshing, setRefreshing] = useState(false)
	const live = useRef(true)
	const hasValue = useRef(false)
	// The latest `load`, so a re-read asked for during a run reads what the screen now wants.
	const latest = useRef(load)
	latest.current = load
	const running = useRef<Promise<void> | undefined>(undefined)
	const again = useRef(false)

	useEffect(() => {
		live.current = true
		return () => {
			live.current = false
		}
	}, [])

	const once = useCallback(async () => {
		if (hasValue.current) setRefreshing(true)
		else setState('loading')
		const fail = (failure: DataError) => {
			setError(failure)
			// The last good value stays on screen; only a screen with nothing to show fails.
			if (!hasValue.current) setState('failed')
		}
		try {
			const result = await latest.current()
			if (!live.current) {
				return
			}
			if (result.ok) {
				hasValue.current = true
				setValue(result.value)
				setError(undefined)
				setState('ready')
				return
			}
			fail(result.error)
		} catch (thrown) {
			if (!live.current) {
				return
			}
			fail({
				kind: 'unexpected',
				message: describeThrown(thrown),
				retryable: true,
			})
		} finally {
			if (live.current) setRefreshing(false)
		}
	}, [])

	/**
	 * One read at a time. Every commit, the other party's included, asks every mounted screen to
	 * re-read; on a slow phone a read takes longer than commits take to arrive, so starting one per
	 * ask piles reads onto the store without bound. Asks during a read become one more read after it.
	 */
	const run = useCallback((): Promise<void> => {
		if (running.current) {
			again.current = true
			return running.current
		}
		const reading = (async () => {
			try {
				do {
					again.current = false
					await once()
				} while (again.current && live.current)
			} finally {
				running.current = undefined
			}
		})()
		running.current = reading
		return reading
	}, [once])

	// Re-read when the world changes under us — a deep link switching the mock
	// variant does not remount a screen that is already showing.
	const generation = useSyncExternalStore(subscribeGeneration, getGeneration, getGeneration)

	// A different `load` is a different read (another tally, say): what was shown is not its answer.
	const shownFor = useRef(load)
	useEffect(() => {
		if (shownFor.current !== load) {
			shownFor.current = load
			hasValue.current = false
		}
		void run()
	}, [run, load, generation])

	return { state, value, error, refreshing, reload: () => void run() }
}
