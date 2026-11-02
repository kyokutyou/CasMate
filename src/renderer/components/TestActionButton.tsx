import type { ComponentProps } from 'react';
import './test-action-button.css';

export function TestActionButton({ children, className = '', ...props }: ComponentProps<'button'>) {
  return <button type="button" {...props} className={`secondary test-action-button ${className}`}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/></svg><span>{children}</span></button>;
}
