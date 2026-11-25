import { jest } from '@jest/globals'
import { noopTraceSink, safeTraceSink, type TraceEvent } from './trace.js'

const sampleEvent: TraceEvent = {
	type: 'query-sent',
	time: 100,
	nodeId: 'node-a',
	sessionCode: 'code-xyz',
	nonce: 'nonce-1',
	depth: 0,
	round: 1,
}

describe('noopTraceSink', () => {
	it('accepts any event and returns undefined without throwing', () => {
		expect(() => noopTraceSink(sampleEvent)).not.toThrow()
		expect(noopTraceSink(sampleEvent)).toBeUndefined()
	})
})

describe('safeTraceSink', () => {
	const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

	afterEach(() => {
		errorSpy.mockClear()
	})
	afterAll(() => {
		errorSpy.mockRestore()
	})

	it('passes an event through to a non-throwing sink unchanged', () => {
		const received: TraceEvent[] = []
		const safe = safeTraceSink((e) => received.push(e))
		safe(sampleEvent)
		expect(received).toEqual([sampleEvent])
		expect(received[0]).toBe(sampleEvent)
		expect(errorSpy).not.toHaveBeenCalled()
	})

	it('swallows a throw so the engine-visible call still returns', () => {
		const safe = safeTraceSink(() => {
			throw new Error('sink boom')
		})
		expect(() => safe(sampleEvent)).not.toThrow()
		expect(safe(sampleEvent)).toBeUndefined()
	})

	it('logs at most once across repeated throws from one wrapped sink', () => {
		const safe = safeTraceSink(() => {
			throw new Error('sink boom')
		})
		safe(sampleEvent)
		safe(sampleEvent)
		safe(sampleEvent)
		expect(errorSpy).toHaveBeenCalledTimes(1)
	})

	it('dedupes per wrapped instance — a fresh wrapper logs again', () => {
		const throwingSink = (): void => {
			throw new Error('sink boom')
		}
		safeTraceSink(throwingSink)(sampleEvent)
		safeTraceSink(throwingSink)(sampleEvent)
		expect(errorSpy).toHaveBeenCalledTimes(2)
	})

	it('keeps delivering events to a sink that only throws intermittently', () => {
		const received: TraceEvent[] = []
		let calls = 0
		const safe = safeTraceSink((e) => {
			calls++
			if (calls === 1) {
				throw new Error('first call throws')
			}
			received.push(e)
		})
		safe(sampleEvent) // throws, swallowed
		safe(sampleEvent) // delivered
		expect(received).toEqual([sampleEvent])
		expect(errorSpy).toHaveBeenCalledTimes(1)
	})
})
