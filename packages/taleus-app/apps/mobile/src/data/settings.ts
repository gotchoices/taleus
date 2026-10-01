/** settings: answered by the active Taleus model -- see `config.ts`. Screens import from here, unchanged. */
import type { SettingsModel } from 'taleus-model/settings'
import { getModel, mockControls } from './config'

export * from 'taleus-model/settings'

export const readSettings = (...args: Parameters<SettingsModel['readSettings']>): ReturnType<SettingsModel['readSettings']> =>
	getModel().settings.readSettings(...args)
export const writeSettings = (...args: Parameters<SettingsModel['writeSettings']>): ReturnType<SettingsModel['writeSettings']> =>
	getModel().settings.writeSettings(...args)

/** Forget this namespace's mock writes. Tests and scenario capture only. */
export function resetSettings(): void {
	mockControls().reset('settings')
}
