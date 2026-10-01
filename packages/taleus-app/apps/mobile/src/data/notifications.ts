/** notifications: answered by the active Taleus model -- see `config.ts`. Screens import from here, unchanged. */
import type { NotificationsModel } from 'taleus-model/notifications'
import { getModel, mockControls } from './config'

export * from 'taleus-model/notifications'

export const readNotifications = (...args: Parameters<NotificationsModel['readNotifications']>): ReturnType<NotificationsModel['readNotifications']> =>
	getModel().notifications.readNotifications(...args)
export const setDelivery = (...args: Parameters<NotificationsModel['setDelivery']>): ReturnType<NotificationsModel['setDelivery']> =>
	getModel().notifications.setDelivery(...args)
export const setNotifications = (...args: Parameters<NotificationsModel['setNotifications']>): ReturnType<NotificationsModel['setNotifications']> =>
	getModel().notifications.setNotifications(...args)

/** Forget this namespace's mock writes. Tests and scenario capture only. */
export function resetNotifications(): void {
	mockControls().reset('notifications')
}
