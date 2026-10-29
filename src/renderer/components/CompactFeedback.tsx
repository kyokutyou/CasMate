import type { HTMLAttributes, ReactNode } from 'react';
import './compact-feedback.css';

interface Props extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'span';
  reserve: readonly string[];
  children: ReactNode;
}

/** Size feedback from its known messages, independently of the current state. */
export function CompactFeedback({ as: Element = 'div', reserve, children, className = '', ...props }: Props) {
  return <Element {...props} className={`compact-feedback ${className}`}>
    <span className="compact-feedback-reserve" aria-hidden="true">
      {reserve.map((text, index) => <span key={index} data-reserve={text} />)}
    </span>
    <span className="compact-feedback-content">{children}</span>
  </Element>;
}
