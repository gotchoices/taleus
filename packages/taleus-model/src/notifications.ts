/** notifications: shapes and policy shared by every implementation of the model. */
import type { Result } from './types.js'

/**
 * What the app does with an event — and nothing more than that.
 *
 * Whether an interruption actually rings, vibrates or waits for quiet hours is
 * the phone's decision, and the party already has that where they expect it
 * (story 43 step 6). What the app owes them is an honest classification, so the
 * policy they already set can act on something real.
 */
export type Delivery = 'interrupt' | 'inform' | 'silent'

/**
 * The four kinds of thing that happen to a party, in the order they care.
 *
 * `signature` needs them to sign something; `asked` is somebody's claim on
 * them; `arrived` is a courtesy; `automatic` is value moving under authority
 * they already gave.
 */
export type NoticeClassId = 'signature' | 'asked' | 'arrived' | 'automatic'

export interface NoticeClass {
	id: NoticeClassId
	delivery: Delivery
	/**
	 * Not the party's to change. Only `automatic` is: they authorised it, there
	 * is nothing for them to do, and notifying would be the app deciding its own
	 * events are important (path A).
	 */
	fixed?: boolean
}

/** What shows when the phone lights up on a table between other people. */
export type LockScreenDetail = 'minimal' | 'full'

export interface NotificationSettings {
	permission: 'granted' | 'denied' | 'unasked'
	classes: NoticeClass[]
	lockScreenDetail: LockScreenDetail
	/**
	 * Whether the phone may be roused to take part in settling. Not a message:
	 * there is nothing to read or dismiss (path B step 2).
	 */
	backgroundParticipation: boolean
	/**
	 * Whether anything of the party's stays on. Read from their devices, not
	 * stored here — path B's answer is a machine, not a setting.
	 */
	hasAlwaysOnDevice: boolean
}

/** What a screen can read and do about notifications. Both the mock and the engine implement it. */
export interface NotificationsModel {
	readNotifications(): Promise<Result<NotificationSettings>>
	setDelivery(id: NoticeClassId, delivery: Delivery): Promise<Result<NotificationSettings>>
	setNotifications(change: Partial<Pick<NotificationSettings, 'lockScreenDetail' | 'backgroundParticipation'>>): Promise<Result<NotificationSettings>>
}
