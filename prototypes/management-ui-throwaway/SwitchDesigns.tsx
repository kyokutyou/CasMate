// THROWAWAY: compare borderless switches without changing the surrounding card.
import { type Values } from './model';

const appearances = [
  { id: 'slim', name: 'スリム', description: '小さな丸いつまみと、すっきりしたレール。おすすめ。' },
  { id: 'soft', name: 'ソフト', description: '少し大きめのつまみ。オンのときだけ、柔らかな光。' },
  { id: 'line', name: 'ライン', description: '細い線の上をつまみが移動。最も軽い見た目。' },
] as const;

export function DemoSwitch({ on, name, change, appearance = 'slim' }: { on: boolean; name: string; change(): void; appearance?: string }) {
  const style = appearances.find(a => a.id === appearance)?.id ?? 'slim';
  return <button className={`composed-switch borderless-switch switch-${style} ${on ? 'is-on' : 'is-off'}`} role="switch" aria-checked={on} aria-label={name} onClick={change}><span className="switch-track" aria-hidden="true"><i/></span><span>{on ? 'オン' : 'オフ'}</span></button>;
}

export function SwitchDesigns({ values, update, choose }: { values: Values; update(key: string, value: string | boolean): void; choose(style: string): void }) {
  const selected = String(values.demoSwitchStyle ?? 'slim');
  return <><p className="modal-intro">外側の枠は付けず、スライダーと文字だけで状態を示します。各スイッチを押して動きを比べられます。</p><div className="switch-designs">{appearances.map((style, index) => {
    const key = `demoSwitchPreview-${style.id}`;
    return <section key={style.id} className="switch-design-option"><div className="switch-design-title"><h3><span>0{index + 1}</span>{style.name}</h3>{selected === style.id && <span className="pill good">表示中</span>}</div><div className="switch-design-example"><span>コメント読み上げ</span><DemoSwitch appearance={style.id} name={`${style.name}の見本`} on={values[key] !== false} change={() => update(key, values[key] === false)}/></div><p>{style.description}</p><button className="switch-design-choose" onClick={() => choose(style.id)}>{style.name}をホームで見る <span aria-hidden="true">›</span></button></section>;
  })}</div><p className="sample-note">見本のオン・オフは配信支援の状態と独立しています。見た目の選択はA5〜A7で共通です。</p></>;
}
