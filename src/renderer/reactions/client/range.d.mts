import type { ReactionRegion } from '../../../shared/listener-reactions';
export function placeArea(container: HTMLElement, area: ReactionRegion, shape: 'ellipse' | 'rectangle', canvasWidth?: number, options?: {duration?:number;variant?:string;clip?:ReactionRegion|null}): HTMLElement | null;
