// `taleus-core/host`: what a host needs to implement `StoreProvider` over its own strands. The
// consumer surface (`taleus-core`) stays free of schema-level detail; a store is the one place
// that must speak it, so these few pieces are shared rather than re-derived per host.
export { APP_SCHEMA, appTable, tablesIn, transactionBatch, watchTables, type RowWrite } from './store/strand.js'
