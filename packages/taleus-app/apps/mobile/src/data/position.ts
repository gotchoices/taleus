/** position: answered by the active Taleus model -- see `config.ts`. Screens import from here, unchanged. */
import type { PositionModel } from 'taleus-model/position'
import { getModel } from './config'

export * from 'taleus-model/position'

export const readPosition = (...args: Parameters<PositionModel['readPosition']>): ReturnType<PositionModel['readPosition']> =>
	getModel().position.readPosition(...args)
