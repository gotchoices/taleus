// TMPDBG: cadre-core's first-sync gate and Optimystic's commit path (transactor, coordinator,
// cluster), on top of the kit's default timings. Must load before any library module (each copy of
// `debug` reads DEBUG once, when it loads).
/* global __DEV__ */
if (__DEV__) {
	process.env.DEBUG = [
		'sereus:cadre:timing',
		'sereus:cadre:strand-first-sync',
		'optimystic:db-core:network-transactor',
		'optimystic:db-core:trx:coordinator',
		'optimystic:db-p2p:cluster',
		'optimystic:db-p2p:cluster-member',
		'optimystic:db-p2p:coordinator-repo*',
	].join(',')
}
