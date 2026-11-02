/** Build historical fixtures from today's defaults using the pre-17 overlay shape. */
export function legacySettingsJson(value: object, space?: number): string {
  if ('schemaVersion' in value && typeof value.schemaVersion === 'number' && value.schemaVersion <= 16 &&
      'commentOverlay' in value && value.commentOverlay && typeof value.commentOverlay === 'object') {
    const overlay = Object.fromEntries(Object.entries(value.commentOverlay).filter(([key]) => !['stackMaxComments', 'stackAlignment'].includes(key)));
    return JSON.stringify({ ...value, commentOverlay: { ...overlay,
      stackDurationSeconds: Object.hasOwn(overlay, 'stackDurationSeconds') ? overlay.stackDurationSeconds : 10 } }, null, space);
  }
  return JSON.stringify(value, null, space);
}
