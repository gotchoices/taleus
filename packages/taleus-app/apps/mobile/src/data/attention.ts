/** attention: answered by the active Taleus model -- see `config.ts`. Screens import from here, unchanged. */
import type { AttentionModel } from 'taleus-model/attention'
import { getModel, mockControls } from './config'

export * from 'taleus-model/attention'

export const listAttention = (...args: Parameters<AttentionModel['listAttention']>): ReturnType<AttentionModel['listAttention']> =>
	getModel().attention.listAttention(...args)
export const listPast = (...args: Parameters<AttentionModel['listPast']>): ReturnType<AttentionModel['listPast']> =>
	getModel().attention.listPast(...args)
export const setAside = (...args: Parameters<AttentionModel['setAside']>): ReturnType<AttentionModel['setAside']> =>
	getModel().attention.setAside(...args)
export const bringBack = (...args: Parameters<AttentionModel['bringBack']>): ReturnType<AttentionModel['bringBack']> =>
	getModel().attention.bringBack(...args)
export const wasSetAside = (...args: Parameters<AttentionModel['wasSetAside']>): ReturnType<AttentionModel['wasSetAside']> =>
	getModel().attention.wasSetAside(...args)

/** Forget this namespace's mock writes. Tests and scenario capture only. */
export function resetAttention(): void {
	mockControls().reset('attention')
}
