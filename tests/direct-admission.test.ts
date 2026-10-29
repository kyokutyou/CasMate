import { expect, it, vi } from 'vitest';
import { DirectAdmission } from '../src/main/smartphone/direct-admission';

it('未認証の1接続元が上限を満たしても別端末を受け入れ、認証成功で未認証枠を解放する', () => {
  const admission = new DirectAdmission(); const reject = vi.fn();
  try {
    for (let i = 0; i < 8; i++) expect(admission.open(`a${i}`, 'A', reject)).toBe(true);
    expect(admission.open('overflow', 'A', reject)).toBe(false); expect(reject).toHaveBeenCalledOnce();
    expect(admission.open('b', 'B', reject)).toBe(true); admission.secure('b'); admission.authenticated('b');
    admission.authenticated('a0'); expect(admission.open('a9', 'A', reject)).toBe(true);
    admission.closed('a9');
    for (let i = 0; i < 20; i++) admission.failed('a1');
    expect(admission.open('a10', 'A', reject)).toBe(false); expect(admission.open('b2', 'B', reject)).toBe(true);
  } finally { admission.close(); }
});
it('TLS・資格未提示を期限で閉じ、認証済み通信の期限は解除する', () => {
  vi.useFakeTimers(); const unauthenticated = vi.fn(), authenticated = vi.fn(); const admission = new DirectAdmission();
  try { admission.open('a', 'A', unauthenticated); admission.open('b', 'B', authenticated); admission.authenticated('b');
    vi.advanceTimersByTime(5000); expect(unauthenticated).toHaveBeenCalledOnce(); expect(authenticated).not.toHaveBeenCalled(); }
  finally { admission.close(); vi.useRealTimers(); }
});
