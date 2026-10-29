// Stable entry point for settings callers; validation and disk operations stay separate.
export * from './settings/schema';
export { SettingsStore, type SettingsLoadResult } from './settings/store';
export { UnsupportedSettingsVersionError } from './settings/stored-format';
