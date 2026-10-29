import type { ObsDesigns } from './obs-design';
import { validateObsDesign } from './obs-design';
import type { Target } from './obs-style';

export const savedObsDesignLimit = 100;
export interface SavedObsDesign<T extends Target = Target> { id: string; number: number; design: ObsDesigns[T] }
export interface SavedObsDesignCollection<T extends Target = Target> { nextNumber: number; items: SavedObsDesign<T>[] }
export type SavedObsDesigns = { [T in Target]: SavedObsDesignCollection<T> };
export function emptySavedObsDesigns(): SavedObsDesigns {
  return { comments: { nextNumber: 1, items: [] }, speech: { nextNumber: 1, items: [] } };
}
function record(input: unknown, keys: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) throw new Error('保存したデザインの項目が正しくありません。');
  return input as Record<string, unknown>;
}
function positiveInteger(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
export function savedObsDesignId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) throw new Error('保存したデザインの識別子が正しくありません。');
  return value;
}
function parseCollection<T extends Target>(target: T, input: unknown): SavedObsDesignCollection<T> {
  const data = record(input, ['nextNumber', 'items']);
  if (!positiveInteger(data.nextNumber) || !Array.isArray(data.items) || data.items.length > savedObsDesignLimit) throw new Error('保存したデザインの件数・番号が正しくありません。');
  const nextNumber = data.nextNumber;
  const items = data.items.map(inputItem => {
    const item = record(inputItem, ['id', 'number', 'design']);
    if (!positiveInteger(item.number) || item.number >= nextNumber) throw new Error('保存したデザインの番号が正しくありません。');
    return { id: savedObsDesignId(item.id), number: item.number, design: validateObsDesign(target, item.design) };
  });
  if (new Set(items.map(item => item.id)).size !== items.length || new Set(items.map(item => item.number)).size !== items.length) throw new Error('保存したデザインの番号・識別子が重複しています。');
  return { nextNumber, items };
}
export function validateSavedObsDesigns(input: unknown): SavedObsDesigns {
  const data = record(input, ['comments', 'speech']);
  return { comments: parseCollection('comments', data.comments), speech: parseCollection('speech', data.speech) };
}
function append<T extends Target>(target: T, collection: SavedObsDesignCollection<T>, input: unknown): SavedObsDesignCollection<T> {
  const data = record(input, ['id', 'design']);
  const id = savedObsDesignId(data.id), design = validateObsDesign(target, data.design);
  const existing = collection.items.find(item => item.id === id);
  if (existing) {
    if (JSON.stringify(existing.design) !== JSON.stringify(design)) throw new Error('同じ保存要求に異なるデザインが指定されています。');
    return collection;
  }
  if (collection.items.length >= savedObsDesignLimit || collection.nextNumber >= Number.MAX_SAFE_INTEGER) throw new Error('これ以上デザインを残せません。不要な保存を削除してください。');
  return { nextNumber: collection.nextNumber + 1, items: [...collection.items, { id, number: collection.nextNumber, design }] };
}
export function addSavedObsDesign(library: SavedObsDesigns, target: Target, input: unknown): SavedObsDesigns {
  return target === 'comments' ? { ...library, comments: append(target, library.comments, input) } : { ...library, speech: append(target, library.speech, input) };
}
export function removeSavedObsDesign(library: SavedObsDesigns, target: Target, id: unknown): SavedObsDesigns {
  const key = savedObsDesignId(id);
  return { ...library, [target]: { ...library[target], items: library[target].items.filter(item => item.id !== key) } };
}
