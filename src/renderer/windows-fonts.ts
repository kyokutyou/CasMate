export async function loadWindowsFonts(): Promise<string[]> {
  const token = document.querySelector<HTMLMetaElement>('meta[name="casmate-management"]')?.content;
  if (!token) throw new Error('管理認証を確認できません。');
  const response = await fetch('/api/management/fonts', { headers: { 'X-CasMate-Management': token }, signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error('フォント一覧を取得できませんでした。再取得してください。');
  const result: unknown = await response.json();
  if (!result || typeof result !== 'object' || !('fonts' in result) || !Array.isArray(result.fonts) || !result.fonts.every((name): name is string => typeof name === 'string')) throw new Error('フォント一覧を取得できませんでした。');
  return result.fonts;
}
