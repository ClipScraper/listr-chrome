import browser from 'webextension-polyfill';

export type InstagramItem = { url: string; type: 'video' | 'pictures' };

// Module state for Instagram incremental collection
const collectedInstaLinks = new Set<string>();
const collectedInstaItems: InstagramItem[] = [];

function toAbsoluteInstagramUrl(pathOrUrl: string): string | null {
  try {
    const u = pathOrUrl.startsWith('http')
      ? new URL(pathOrUrl)
      : new URL(pathOrUrl, 'https://www.instagram.com');
    if (!/\.instagram\.com$/.test(u.hostname)) return null;
    let finalPath = u.pathname.endsWith('/') ? u.pathname : u.pathname + '/';
    u.pathname = finalPath;
    u.hash = '';
    u.search = '';
    return u.toString();
  } catch {
    return null;
  }
}

function scanAndCollectInstagramLinks(logEach: boolean = true): InstagramItem[] {
  const newlyFound: InstagramItem[] = [];
  document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(a => {
    const rawHref = a.getAttribute('href') || '';
    if (!rawHref) return;
    const path = rawHref.split('?')[0];
    const reelMatch = path.match(/^\/(?:[^/]+\/)?reel\/[^/]+\/?$/);
    const postMatch = path.match(/^\/(?:[^/]+\/)?p\/[^/]+\/?$/);

    let type: 'video' | 'pictures' | null = null;
    if (reelMatch) type = 'video';
    else if (postMatch) type = 'pictures';
    if (!type) return;

    const abs = toAbsoluteInstagramUrl(path);
    if (!abs) return;
    if (!collectedInstaLinks.has(abs)) {
      collectedInstaLinks.add(abs);
      const item: InstagramItem = { url: abs, type };
      collectedInstaItems.push(item);
      newlyFound.push(item);
      if (logEach) {
        console.log('Added Instagram link:', item);
      }
    }
  });
  return newlyFound;
}

export function onScrollTickInstagram() {
  // Discover new links and notify popup incrementally
  const newly = scanAndCollectInstagramLinks(true);
  if (newly.length > 0) {
    try {
      browser.runtime.sendMessage({ type: 'instaNewLinks', links: newly.map(n => n.url) })
        .catch(() => {});
    } catch {}
  }
}

function collectInstagramPostLinks(): { links: string[]; items: InstagramItem[] } {
  // Final pass to ensure we didn't miss anything right at the end
  scanAndCollectInstagramLinks(false);
  console.log('Finished collecting Instagram links. Total unique links:', collectedInstaLinks.size);
  return { links: Array.from(collectedInstaLinks), items: [...collectedInstaItems] };
}

let initialized = false;
export function initInstagramContent() {
  if (initialized) return;
  initialized = true;
  browser.runtime.onMessage.addListener((message: any) => {
    if (message.action === 'collectInstagramPostLinks') {
      const { links, items } = collectInstagramPostLinks();
      return { links, items };
    }
    return undefined;
  });
}


