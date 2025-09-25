import browser from 'webextension-polyfill';

// TikTok incremental collection state
const collectedTiktokFavLinks = new Set<string>();

// Selection mode state (TikTok-specific usage)
let selectionMode = false;
const selectedAnchors = new Set<HTMLAnchorElement>();

function isOnTiktokFavoritesPage(): boolean {
  try {
    const u = new URL(location.href);
    if (!/\.tiktok\.com$/.test(u.hostname)) return false;
    if (/\/collection\//.test(u.pathname)) return false;
    if (document.querySelector('[data-e2e="liked-tab"][aria-selected="true"]')) return false;
    if (document.querySelector('[data-e2e="repost-tab"][aria-selected="true"]')) return false;
    const favoritesSelected = document.querySelector('[data-e2e="favorites-tab"][aria-selected="true"]');
    if (favoritesSelected) return true;
    return document.querySelector('[data-e2e="favorites-item"]') != null;
  } catch {
    return false;
  }
}

function isOnTiktokCollectionPage(): boolean {
  try {
    const u = new URL(location.href);
    return /\/collection\//.test(u.pathname);
  } catch {
    return false;
  }
}

function getTiktokCollectionRoot(): HTMLElement | null {
  return document.getElementById('main-content-collection');
}
function getTiktokUserPostsRoot(): HTMLElement | null {
  return document.querySelector('[data-e2e="user-post-item-list"]') as HTMLElement | null;
}
function getTiktokLikedRoot(): HTMLElement | null {
  return document.querySelector('[data-e2e="user-liked-item-list"]') as HTMLElement | null;
}
function getTiktokRepostRoot(): HTMLElement | null {
  return document.querySelector('[data-e2e="user-repost-item-list"]') as HTMLElement | null;
}

function scanAndCollectTiktokFavorites(logEach: boolean = false): string[] {
  if (!/\.tiktok\.com$/.test(location.hostname)) return [];
  const newly: string[] = [];

  let selector = '';
  if (isOnTiktokFavoritesPage()) {
    selector = '[data-e2e="favorites-item"] a[href^="https://www.tiktok.com/"]';
  } else if (getTiktokLikedRoot()) {
    selector = 'a[href^="https://www.tiktok.com/"]';
  } else if (getTiktokRepostRoot()) {
    selector = 'a[href^="https://www.tiktok.com/"]';
  } else if (getTiktokUserPostsRoot()) {
    selector = 'a[href^="https://www.tiktok.com/"]';
  } else if (isOnTiktokCollectionPage()) {
    selector = 'div[aria-label="Watch in full screen"] a[href^="https://www.tiktok.com/"]';
  } else {
    selector = 'div[aria-label="Watch in full screen"] a[href^="https://www.tiktok.com/"]';
  }

  const collectionRoot = getTiktokCollectionRoot();
  const likedRoot = getTiktokLikedRoot();
  const repostRoot = getTiktokRepostRoot();
  const userPostsRoot = getTiktokUserPostsRoot();
  const scopeEl: Document | Element = (isOnTiktokCollectionPage() && collectionRoot)
    ? (collectionRoot as HTMLElement)
    : (likedRoot ? likedRoot
      : (repostRoot ? repostRoot
        : (userPostsRoot ? userPostsRoot : document)));

  scopeEl.querySelectorAll(selector).forEach((a: Element) => {
    const anchor = a as HTMLAnchorElement;
    if (!anchor) return;
    const isVisible = !!(anchor.offsetParent || (anchor as any).offsetWidth || (anchor as any).offsetHeight);
    if (!isVisible) return;
    const href = anchor.href.split('?')[0];
    if (/^https:\/\/www\.tiktok\.com\/[^/]+\/(?:video|photo)\/\d+/.test(href)) {
      if (!collectedTiktokFavLinks.has(href)) {
        collectedTiktokFavLinks.add(href);
        newly.push(href);
        if (logEach) console.log('Added TikTok favorite:', href);
      }
    }
  });

  return newly;
}

// Inject minimal CSS for selection overlay
(function injectSelectionCSS() {
  const style = document.createElement('style');
  style.textContent = `
    .my-ext-selected {
      position: relative;
      outline: 2px solid white;
    }
    .my-ext-selected::after {
      content: "";
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(255,255,255,0.4);
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);
})();

// Toggle anchors in selection mode
document.addEventListener('click', (e) => {
  if (!selectionMode) return;
  const target = e.target as HTMLElement;
  const anchor = target.closest('a') as HTMLAnchorElement | null;
  if (!anchor) return;
  const href = anchor.href;
  if (/^https:\/\/www\.tiktok\.com\/[^/]+\/video\/\d+/.test(href)) {
    e.preventDefault();
    e.stopPropagation();
    if (selectedAnchors.has(anchor)) {
      selectedAnchors.delete(anchor);
      anchor.classList.remove('my-ext-selected');
    } else {
      selectedAnchors.add(anchor);
      anchor.classList.add('my-ext-selected');
    }
  }
});

export function onScrollTickTiktok() {
  const newlyTk = scanAndCollectTiktokFavorites(true);
  if (newlyTk.length > 0) {
    try {
      browser.runtime.sendMessage({ type: 'tiktokNewLinks', links: newlyTk })
        .catch(() => {});
    } catch {}
  }
}

let initialized = false;
export function initTiktokContent() {
  if (initialized) return;
  initialized = true;

  browser.runtime.onMessage.addListener((message: any) => {
    if (message.action === 'collectAllVideoLinks') {
      const allLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a'))
        .map(a => a.href)
        .filter(href => /^https:\/\/www\.tiktok\.com\/[^/]+\/video\/\d+/.test(href));
      return { links: allLinks };
    }
    if (message.action === 'startSelectionMode') {
      selectionMode = true;
      selectedAnchors.forEach(a => a.classList.remove('my-ext-selected'));
      selectedAnchors.clear();
      return { status: 'Selection mode started' };
    }
    if (message.action === 'validateSelection') {
      const links = Array.from(selectedAnchors).map(a => a.href);
      selectedAnchors.forEach(a => a.classList.remove('my-ext-selected'));
      selectedAnchors.clear();
      selectionMode = false;
      return { status: 'Selection validated', links };
    }
    if (message.action === 'cancelSelection') {
      selectedAnchors.forEach(a => a.classList.remove('my-ext-selected'));
      selectedAnchors.clear();
      selectionMode = false;
      return { status: 'Selection canceled' };
    }
    if (message.action === 'collectTiktokFavoritesLinks') {
      const links = Array.from(collectedTiktokFavLinks);
      return { links };
    }
    if (message.action === 'resetTiktokFavoritesState') {
      collectedTiktokFavLinks.clear();
      return { status: 'cleared' };
    }
    if (message.action === 'scanTiktokFavoritesOnce') {
      const links = scanAndCollectTiktokFavorites(true);
      return { links };
    }
    if (message.action === 'detectTiktokSection') {
      try {
        const username = location.href.match(/\/(@[^/]+)/)?.[1]?.replace(/^@/, '') || '';
        let section: 'favorites' | 'liked' | 'reposts' | 'videos' | 'unknown' = 'unknown';
        if (document.querySelector('[data-e2e="liked-tab"][aria-selected="true"]')) section = 'liked';
        else if (document.querySelector('[data-e2e="repost-tab"][aria-selected="true"]')) section = 'reposts';
        else {
          const selectedTabs = Array.from(document.querySelectorAll('[role="tab"][aria-selected="true"]')) as HTMLElement[];
          const text = selectedTabs.map(n => (n.textContent || '').toLowerCase()).join(' ');
          const classes = selectedTabs.map(n => n.className || '').join(' ');
          if (/favorite/.test(text) || /PFavorite/i.test(classes)) section = 'favorites';
          else if (/video|posts/.test(text)) section = 'videos';
        }
        return { username, section };
      } catch {
        return { username: '', section: 'unknown' };
      }
    }
    return undefined;
  });
}


