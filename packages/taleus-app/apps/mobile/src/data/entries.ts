/** entries: answered by the active Taleus model -- see `config.ts`. Screens import from here, unchanged. */
import type { EntriesModel } from 'taleus-model/entries'
import { getModel, mockControls } from './config'

export * from 'taleus-model/entries'

export const listEntries = (...args: Parameters<EntriesModel['listEntries']>): ReturnType<EntriesModel['listEntries']> =>
	getModel().entries.listEntries(...args)
export const readEntry = (...args: Parameters<EntriesModel['readEntry']>): ReturnType<EntriesModel['readEntry']> =>
	getModel().entries.readEntry(...args)
export const previewEntry = (...args: Parameters<EntriesModel['previewEntry']>): ReturnType<EntriesModel['previewEntry']> =>
	getModel().entries.previewEntry(...args)
export const recordEntry = (...args: Parameters<EntriesModel['recordEntry']>): ReturnType<EntriesModel['recordEntry']> =>
	getModel().entries.recordEntry(...args)

/** Forget this namespace's mock writes. Tests and scenario capture only. */
export function resetEntries(): void {
	mockControls().reset('entries')
}
