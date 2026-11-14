import type { ReactionArrowPoint } from '../../../shared/reaction-arrow';
import type { ReactionRegion } from '../../../shared/listener-reactions';
export function shortArrow(to:ReactionArrowPoint,width?:number,height?:number):{from:ReactionArrowPoint;to:ReactionArrowPoint};
export function moveArrow(node:HTMLElement|null,from:ReactionArrowPoint,to:ReactionArrowPoint):void;
export function placeArrow(container:HTMLElement,from:ReactionArrowPoint,to:ReactionArrowPoint,options?:{age?:number;duration?:number;variant?:string;clip?:ReactionRegion|null}):HTMLElement|null;
