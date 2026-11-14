export interface ReactionArrowPoint { x: number; y: number }
export function validArrowPoint(value: unknown): value is ReactionArrowPoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  return Object.keys(p).sort().join(',') === 'x,y' && [p.x,p.y].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1);
}
