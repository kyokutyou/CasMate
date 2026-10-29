export const managementThemeIds = ['graphite', 'midnight', 'ocean', 'burgundy', 'pearl', 'ivory', 'sakura', 'lavender'] as const;
export type ManagementThemeId = typeof managementThemeIds[number];
export const defaultManagementTheme: ManagementThemeId = 'ocean';
export function isManagementTheme(value: unknown): value is ManagementThemeId {
  return typeof value === 'string' && managementThemeIds.some(id => id === value);
}
