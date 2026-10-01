/**
 * The Taleus app model: everything a Taleus app's screens can read and do.
 *
 * This is the seam the screens stand on. They see one `TaleusModel` and nothing behind it --
 * not whether the answers come from fixtures or from taleus-core, and not, in engine mode,
 * where the engine keeps its data. Choosing an implementation is configuration, made once,
 * outside every screen.
 *
 * It is the Taleus *product's* model, deliberately not a general one. A web build of the same
 * app shares it; a different product -- an ERP integration, the MyCHIPs-style UI -- builds on
 * taleus-core directly, so that one product's screens never leak into the core.
 */
import type { AttentionModel } from './attention.js'
import type { DevicesModel } from './devices.js'
import type { EntriesModel } from './entries.js'
import type { InvitationsModel } from './invitations.js'
import type { NotificationsModel } from './notifications.js'
import type { OffersModel } from './offers.js'
import type { PartyModel } from './party.js'
import type { PositionModel } from './position.js'
import type { ProfileModel } from './profile.js'
import type { RatesModel } from './rates.js'
import type { RequestsModel } from './requests.js'
import type { SettingsModel } from './settings.js'
import type { StandingModel } from './standing.js'
import type { TalliesModel } from './tallies.js'
import type { TallyModel } from './tally.js'
import type { Variant } from './variant.js'

export interface TaleusModel {
	attention: AttentionModel
	devices: DevicesModel
	entries: EntriesModel
	invitations: InvitationsModel
	notifications: NotificationsModel
	offers: OffersModel
	party: PartyModel
	position: PositionModel
	profile: ProfileModel
	rates: RatesModel
	requests: RequestsModel
	settings: SettingsModel
	standing: StandingModel
	tallies: TalliesModel
	tally: TallyModel
}

/**
 * What only the mock model can do. Screens never touch these: the variant arrives on a deep link
 * and is applied by the app shell, and `reset` exists so that tests and scenario capture start
 * from a known state.
 */
export interface MockControls {
	getVariant(): Variant
	setVariant(variant: string): void
	/** Forget the mock writes in one namespace, or in every namespace when none is named. */
	reset(namespace?: keyof TaleusModel): void
}
