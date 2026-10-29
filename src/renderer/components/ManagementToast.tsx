export function ManagementToast({ notice }: { notice?: { message: string; tone: string } | null }) {
  return <div className="toast-region" role="region" aria-label="通知" aria-live="polite" aria-atomic="true">
    {notice?.tone === 'success' && <div className="banner"><span className="toast-check" aria-hidden="true">✓</span>
      <span className="toast-message" title={notice.message}>{notice.message}</span></div>}
  </div>;
}
