export const REACTION_STICKERS = [
  { id: 'surprise', sample: 3, name: 'えっ！？', duration: 3800 },
  { id: 'confused', sample: 4, name: '困惑', duration: 4200 },
  { id: 'agree', sample: 6, name: 'わかる', duration: 4300 },
  { id: 'scared', sample: 8, name: 'こわい…', duration: 4200 },
  { id: 'safe', sample: 19, name: 'セーフ！', duration: 4300 },
  { id: 'danger', sample: 20, name: '危ない！', duration: 4100 },
  { id: 'thanks', sample: 23, name: 'おつかれさま', duration: 4600 },
  { id: 'cheers', sample: 25, name: '乾杯！', duration: 4400 },
  { id: 'rest', sample: 28, name: 'ひと休みしよ', duration: 4800 },
] as const;
export type ReactionStickerId = typeof REACTION_STICKERS[number]['id'];
export const reactionSticker = (id: unknown) => REACTION_STICKERS.find(sticker => sticker.id === id);
