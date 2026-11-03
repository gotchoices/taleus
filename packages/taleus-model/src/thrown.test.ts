import { describeThrown } from './thrown.js'

describe('describeThrown', () => {
	it('gives an Error its message', () => {
		expect(describeThrown(new Error('no route'))).toBe('no route')
	})
	it('describes an event-like object rather than [object Object]', () => {
		expect(describeThrown({ type: 'error', message: 'connection refused', code: 1006 })).toBe('error: connection refused (code 1006)')
	})
	it('falls back to JSON, then to String', () => {
		expect(describeThrown({ status: 503 })).toBe('{"status":503}')
		expect(describeThrown('plain')).toBe('plain')
	})
})
