export function getYouTubePageTitle(url: string): string {
  try {
    const u = new URL(url);
    const handle = u.pathname.match(/\/(@[A-Za-z0-9._-]+)/)?.[1];
    if (handle) return `YouTube Channel: ${handle}`;
    if (u.pathname.startsWith('/channel/')) return 'YouTube Channel';
    if (u.pathname.startsWith('/watch')) return 'YouTube Video';
  } catch {}
  return 'YouTube';
}
