export const managementTextSizeIds = ['small', 'medium', 'large'] as const;
export type ManagementTextSizeId = typeof managementTextSizeIds[number];
export const defaultManagementTextSize: ManagementTextSizeId = 'medium';

export function isManagementTextSize(value: unknown): value is ManagementTextSizeId {
  return typeof value === 'string' && managementTextSizeIds.some(id => id === value);
}
