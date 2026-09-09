import { renderHook, waitFor } from '@testing-library/react-native'

import { getGeneration } from '../src/data/generation'
import { useLoad } from '../src/hooks/useLoad'
import { setLocale } from '../src/i18n'
import { setVariant } from '../src/mock/variant'
import { Attention } from '../src/screens/Attention'
import { renderScreen, screenProps } from '../testUtils'

beforeEach(() => setVariant('happy'))

test('a variant change bumps the generation; setting the same one does not', () => {
	const start = getGeneration()
	setVariant('empty')
	expect(getGeneration()).toBe(start + 1)
	setVariant('empty')
	expect(getGeneration()).toBe(start + 1)
	setVariant('nonsense')
	expect(getGeneration()).toBe(start + 1)
})

test('a locale change bumps it too, so formatting on screen follows', () => {
	const start = getGeneration()
	setLocale('en')
	expect(getGeneration()).toBe(start)
})

test('a screen already showing re-reads when the variant changes under it', async () => {
	const view = await renderScreen(<Attention {...screenProps('Attention', undefined)} />)
	await waitFor(() => expect(view.getByText('Rae Whitfield proposed terms')).toBeTruthy())

	// The bug this guards: a deep link to the route already showing does not
	// remount it, so without the generation the happy list stayed on screen.
	setVariant('empty')
	await waitFor(() => expect(view.getByText('Nothing needs you')).toBeTruthy())
	expect(view.queryByText('Rae Whitfield proposed terms')).toBeNull()
})

test('a reload keeps the previous value, so callers can tell it from a first load', async () => {
	// The bug this guards: a variant change re-ran the session load, which
	// reported `loading`, which unmounted the NavigationContainer mid-navigation.
	// Whether the link survived came down to timing.
	const load = jest.fn().mockResolvedValue({ ok: true, value: 'first' })
	const { result } = await renderHook(() => useLoad(load))
	await waitFor(() => expect(result.current.state).toBe('ready'))
	expect(result.current.value).toBe('first')

	setVariant('error')
	// Still holding the previous answer while re-reading: that is what lets the
	// navigator stay mounted instead of hiding behind a spinner.
	expect(result.current.value).toBe('first')
	await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
})
