export function createManagementWindowOpenHandler(openExternal: (url: string) => void) {
  return ({ url }: { url: string }): { action: 'deny' } => {
    let target: URL;
    try { target = new URL(url); }
    catch { return { action: 'deny' }; }
    if (target.protocol === 'http:' || target.protocol === 'https:') openExternal(url);
    return { action: 'deny' };
  };
}
