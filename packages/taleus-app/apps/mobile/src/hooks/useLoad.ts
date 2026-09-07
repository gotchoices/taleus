import { useCallback, useEffect, useRef, useState } from 'react'

import type { DataError, Result } from '../data/types'

export type LoadState = 'loading' | 'ready' | 'failed'

export interface Loaded<T> {
	state: LoadState
	value?: T
	error?: DataError
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
 */
export function useLoad<T>(load: () => Promise<Result<T>>): Loaded<T> {
	const [state, setState] = useState<LoadState>('loading')
	const [value, setValue] = useState<T | undefined>()
	const [error, setError] = useState<DataError | undefined>()
	const live = useRef(true)

	useEffect(() => {
		live.current = true
		return () => {
			live.current = false
		}
	}, [])

	const run = useCallback(async () => {
		setState('loading')
		setError(undefined)
		try {
			const result = await load()
			if (!live.current) {
				return
			}
			if (result.ok) {
				setValue(result.value)
				setState('ready')
				return
			}
			setError(result.error)
			setState('failed')
		} catch (thrown) {
			if (!live.current) {
				return
			}
			setError({
				kind: 'unexpected',
				message: thrown instanceof Error ? thrown.message : String(thrown),
				retryable: true,
			})
			setState('failed')
		}
	}, [load])

	useEffect(() => {
		void run()
	}, [run])

	return { state, value, error, reload: () => void run() }
}
