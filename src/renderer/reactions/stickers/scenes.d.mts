export const scenes: Map<number, { draw(ctx: CanvasRenderingContext2D, t: number): void }>;
export const H: {
  image(name: string): HTMLImageElement;
  smooth(value: number): number;
  range(value: number, start: number, end: number): number;
  character(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, expression?: string, t?: number, rotation?: number): void;
};
