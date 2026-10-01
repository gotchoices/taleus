/** devices: answered by the active Taleus model -- see `config.ts`. Screens import from here, unchanged. */
import type { DevicesModel } from 'taleus-model/devices'
import { getModel, mockControls } from './config'

export * from 'taleus-model/devices'

export const listDevices = (...args: Parameters<DevicesModel['listDevices']>): ReturnType<DevicesModel['listDevices']> =>
	getModel().devices.listDevices(...args)
export const renameDevice = (...args: Parameters<DevicesModel['renameDevice']>): ReturnType<DevicesModel['renameDevice']> =>
	getModel().devices.renameDevice(...args)
export const retireDevice = (...args: Parameters<DevicesModel['retireDevice']>): ReturnType<DevicesModel['retireDevice']> =>
	getModel().devices.retireDevice(...args)
export const addDevice = (...args: Parameters<DevicesModel['addDevice']>): ReturnType<DevicesModel['addDevice']> =>
	getModel().devices.addDevice(...args)

/** Forget this namespace's mock writes. Tests and scenario capture only. */
export function resetDevices(): void {
	mockControls().reset('devices')
}
