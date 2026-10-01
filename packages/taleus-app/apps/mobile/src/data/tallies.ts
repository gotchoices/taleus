/** tallies: answered by the active Taleus model -- see `config.ts`. Screens import from here, unchanged. */
import type { TalliesModel } from 'taleus-model/tallies'
import { getModel } from './config'

export * from 'taleus-model/tallies'

export const listTallies = (...args: Parameters<TalliesModel['listTallies']>): ReturnType<TalliesModel['listTallies']> =>
	getModel().tallies.listTallies(...args)
