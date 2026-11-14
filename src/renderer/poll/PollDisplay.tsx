import type { CSSProperties } from 'react';
import type { PollAppearance, PublicPoll } from '../../shared/listener-poll';
import './poll.css';

export function PollDisplay({ poll, appearance, selected, disabled, onVote }: {
  poll: PublicPoll; appearance?: PollAppearance; selected?: number;
  disabled?: boolean; onVote?(option: number): void;
}) {
  const total = poll.counts?.reduce((a, b) => a + b, 0);
  const style: CSSProperties | undefined = appearance ? { fontSize: appearance.fontSize, color: appearance.color, background: appearance.background } : undefined;
  return <section className="poll-display" style={style} aria-label="投票のお題と結果">
    <div className="poll-heading"><span className="poll-kicker">LISTENER POLL</span><span className="poll-badge">{poll.closedAt === null ? '受付中' : '受付終了'}</span></div>
    <h2>{poll.question}</h2>
    <ol className="poll-options">{poll.options.map((option, index) => {
      const percent = total ? Math.round(poll.counts![index] / total * 1000) / 10 : 0;
      const content = <><span className="poll-option-line"><span>{onVote ? <span aria-hidden="true" className="poll-choice">{selected === index ? '●' : '○'}</span> : null}{option}</span>{poll.counts && <strong>{poll.counts[index]}票 <small>{percent}%</small></strong>}</span>{poll.counts && <span className="poll-bar-track" aria-hidden="true"><span style={{ width: `${percent}%` }}/></span>}</>;
      return <li key={index}>{onVote ? <button type="button" aria-pressed={selected === index} disabled={disabled} onClick={() => onVote(index)}>{content}</button> : <div className="poll-result-option">{content}</div>}</li>;
    })}</ol>
    <p className="poll-total">{poll.counts ? `合計 ${total}票` : '結果は配信者が公開すると表示されます。'}</p>
  </section>;
}
