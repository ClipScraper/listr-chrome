import browser from 'webextension-polyfill';
import { initYouTubeContent } from './apps/youtube/content';
import { initPinterestContent } from './apps/pinterest/content';

console.log("Content script loaded.");

// Respond to ping immediately using callback form for maximum compatibility
browser.runtime.onMessage.addListener((message: any) => {
  if (message && message.action === 'ping') {
    return { status: 'pong' };
  }
  return undefined; // let other listeners handle
});

/**
 * SCROLLING STATES (unchanged from your code)
 */
let scrolling = false;
let lastHeight = 0;
let lastChangeTime = 0;
let scrollCount = 0;
let timeRemaining = 0;
let checkIntervalId: number | null = null;

/**
 * SELECTION MODE STATES
 */
let selectionMode = false;
const selectedAnchors = new Set<HTMLAnchorElement>();

/**
 * Incremental Instagram collection state
 */
type InstagramItem = { url: string; type: 'video' | 'pictures' };
const collectedInstaLinks = new Set<string>();
const collectedInstaItems: InstagramItem[] = [];
const collectedTiktokFavLinks = new Set<string>();

/** NEW: Pinterest incremental set */
const collectedPinterestLinks = new Set<string>();

function toAbsoluteInstagramUrl(pathOrUrl: string): string | null {
  try {
    // Normalize and ensure trailing slash for consistency
    const u = pathOrUrl.startsWith('http')
      ? new URL(pathOrUrl)
      : new URL(pathOrUrl, 'https://www.instagram.com');
    // Only accept instagram host
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
    // Match /{username}/reel/{id}/ or /reel/{id}/
    const reelMatch = path.match(/^\/(?:[^/]+\/)?reel\/[^/]+\/?$/);
    // Match /{username}/p/{id}/ or /p/{id}/
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

const collectedYouTubeLinks = new Set<string>();
function scanAndCollectYouTubeVideos(logEach: boolean = false): string[] {
  if (!/\.youtube\./.test(location.hostname)) return [];
  const newly: string[] = [];
  const videoSelectors = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-rich-grid-media',
    'ytd-playlist-video-renderer',
  ];
  const videoElements = document.querySelectorAll(videoSelectors.join(', '));

  videoElements.forEach(el => {
    const anchor = el.querySelector(
      'a#thumbnail, a.yt-lockup-view-model__content-image, a.ytd-thumbnail'
    ) as HTMLAnchorElement;
    
    if (anchor?.href) {
      const url = new URL(anchor.href, location.origin).toString();
      if (!collectedYouTubeLinks.has(url)) {
        collectedYouTubeLinks.add(url);
        newly.push(url);
        if (logEach) console.log('Added YouTube video:', url);
      }
    }
  });
  return newly;
}

/** NEW: Pinterest pin scanning */
function scanAndCollectPinterestPins(logEach: boolean = false): string[] {
  if (!/pinterest\./.test(location.hostname)) return [];
  const newly: string[] = [];

  const anchors = document.querySelectorAll<HTMLAnchorElement>('a[href]');
  anchors.forEach(a => {
    const href = a.getAttribute('href') || '';
    if (!href) return;

    // Accept absolute or site-relative links, normalize to absolute
    let url: string;
    try {
      url = new URL(href, location.origin).toString();
    } catch {
      return;
    }

    // Filter strictly to /pin/{id}/ style URLs and strip query/hash
    const m = url.match(/^https:\/\/(?:[^/]+\.)?pinterest\.com\/pin\/(\d+)\/?/i);
    if (!m) return;

    try {
      const u = new URL(url);
      u.hash = '';
      u.search = '';
      // Ensure a trailing slash for consistency
      const path = u.pathname.endsWith('/') ? u.pathname : u.pathname + '/';
      u.pathname = path;
      const finalUrl = u.toString();

      // Only count visible anchors to avoid hidden templates
      const isVisible = !!(a.offsetParent || (a as any).offsetWidth || (a as any).offsetHeight);
      if (!isVisible) return;

      if (!collectedPinterestLinks.has(finalUrl)) {
        collectedPinterestLinks.add(finalUrl);
        newly.push(finalUrl);
        if (logEach) console.log('Added Pinterest pin:', finalUrl);
      }
    } catch {
      /* ignore */
    }
  });

  return newly;
}

/**
 * TikTok favorites scanning
 * - Detects anchors under elements marked with data-e2e="favorites-item"
 * - Also scans generic anchors for video URLs as a fallback
 */
function isOnTiktokFavoritesPage(): boolean {
  try {
    const u = new URL(location.href);
    if (!/\.tiktok\.com$/.test(u.hostname)) return false;
    if (/\/collection\//.test(u.pathname)) return false;
    // Detect the active tab more robustly
    if (document.querySelector('[data-e2e="liked-tab"][aria-selected="true"]')) return false;
    if (document.querySelector('[data-e2e="repost-tab"][aria-selected="true"]')) return false;
    const favoritesSelected = document.querySelector('[data-e2e="favorites-tab"][aria-selected="true"]');
    if (favoritesSelected) return true;
    // Fallback: presence of favorites cards
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
  // TikTok collection pages render the grid under this container
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
    // Liked tab grid
    selector = 'a[href^="https://www.tiktok.com/"]';
  } else if (getTiktokRepostRoot()) {
    // Reposts tab grid
    selector = 'a[href^="https://www.tiktok.com/"]';
  } else if (getTiktokUserPostsRoot()) {
    // Profile videos grid
    selector = 'a[href^="https://www.tiktok.com/"]';
  } else if (isOnTiktokCollectionPage()) {
    // Collection pages: grid cards do not have favorites-item; target the card container aria-label
    selector = 'div[aria-label="Watch in full screen"] a[href^="https://www.tiktok.com/"]';
  } else {
    // Generic profile tabs (liked/reposts): use the visible grid card pattern
    selector = 'div[aria-label="Watch in full screen"] a[href^="https://www.tiktok.com/"]';
  }

  // Constrain scope to the collection root when on a collection page to avoid
  // picking up links from headers/popups (e.g., inbox) elsewhere in the DOM
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
    // Ensure element is visible in layout to avoid hidden sections
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

/**
 * Inject minimal CSS for a white overlay
 */
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

/**
 * On click, if selectionMode is ON, toggle anchor if it's a TikTok video link
 */
document.addEventListener('click', (e) => {
  if (!selectionMode) return;

  const target = e.target as HTMLElement;
  const anchor = target.closest('a') as HTMLAnchorElement | null;
  if (!anchor) return;

  // e.g. https://www.tiktok.com/@someone/video/123456
  const href = anchor.href;
  if (/^https:\/\/www\.tiktok\.com\/[^/]+\/video\/\d+/.test(href)) {
    e.preventDefault();
    e.stopPropagation();
    // Toggle
    if (selectedAnchors.has(anchor)) {
      selectedAnchors.delete(anchor);
      anchor.classList.remove('my-ext-selected');
    } else {
      selectedAnchors.add(anchor);
      anchor.classList.add('my-ext-selected');
    }
  }
});

/** SCROLLING LOGIC (same as your code) */
function initScrollVars() {
  lastHeight = document.documentElement.scrollHeight;
  lastChangeTime = Date.now();
  scrollCount = 0;
  timeRemaining = 0;
}
function startScrolling() {
  if (scrolling) return;
  scrolling = true;
  if (!checkIntervalId) {
    checkIntervalId = window.setInterval(onTick, 1000);
  }
}
function stopScrolling() {
  scrolling = false;
}
function onTick() {
  if (!scrolling) return;
  if (timeRemaining > 0) {
    timeRemaining--;
    sendTimeUpdate(timeRemaining);
  } else {
    doScrollStep();
  }
}
function doScrollStep() {
  const currentHeight = document.documentElement.scrollHeight;
  window.scrollTo(0, currentHeight);
  scrollCount++;

  // Incremental Instagram link discovery while waiting
  const newly = scanAndCollectInstagramLinks(true);
  if (newly.length > 0) {
    try {
      browser.runtime.sendMessage({ type: 'instaNewLinks', links: newly.map(n => n.url) })
        .catch(() => {});
    } catch {}

  }

  // Incremental TikTok favorites discovery on relevant pages
  const newlyTk = scanAndCollectTiktokFavorites(true);
  if (newlyTk.length > 0) {
    try {
      browser.runtime.sendMessage({ type: 'tiktokNewLinks', links: newlyTk })
        .catch(() => {});
    } catch {}
  }

  // Incremental YouTube channel video discovery
  const newlyYt = scanAndCollectYouTubeVideos(true);
  if (newlyYt.length > 0) {
    try {
      browser.runtime.sendMessage({ type: 'youtubeNewLinks', links: newlyYt })
        .catch(() => {});
    } catch {}
  }

  // NEW: Incremental Pinterest pin discovery
  const newlyPins = scanAndCollectPinterestPins(true);
  if (newlyPins.length > 0) {
    try {
      browser.runtime.sendMessage({ type: 'pinterestNewLinks', links: newlyPins })
        .catch(() => {});
    } catch {}
  }

  if (currentHeight > lastHeight) {
    lastHeight = currentHeight;
    lastChangeTime = Date.now();
    console.log(`New content loaded. Updated height: ${currentHeight}`);
  } else {
    if (Date.now() - lastChangeTime > 2000) { // Reduced from 20000 to 2000 (2 seconds)
      console.log("Scrolling stopped. No new content loaded in 2 seconds.");
      stopScrolling();
      browser.runtime.sendMessage({ type: 'scrollComplete' })
        .catch(() => {});
      return;
    }
  }
  const nextDelayMs = 1000; // Reduced from 10000 and 5000 to 1000
  timeRemaining = nextDelayMs / 1000;
  sendTimeUpdate(timeRemaining);
}
function scrollToBottom() {
  const currentHeight = document.documentElement.scrollHeight;
  window.scrollTo(0, currentHeight);
}
function sendTimeUpdate(sec: number) {
  browser.runtime.sendMessage({ type: 'scrollTimeUpdate', timeRemaining: sec })
    .catch(() => {});
}

function collectInstagramPostLinks(): { links: string[]; items: InstagramItem[] } {
  // Final pass to ensure we didn't miss anything right at the end
  scanAndCollectInstagramLinks(false);

  console.log("Finished collecting Instagram links. Total unique links:", collectedInstaLinks.size);
  return { links: Array.from(collectedInstaLinks), items: [...collectedInstaItems] };
}

/**
 * Primary message listener.
 */
browser.runtime.onMessage.addListener(async (message: any, _sender: any) => {
  // Handle 'extensionData' message (previously in a separate listener)
  if (message?.action === 'extensionData') {
    window.postMessage({ source: 'myExtension', payload: message.payload }, '*');
    // No response needed for this action
    return;
  }

  // Use a promise to handle sendResponse, which is required for async listeners.
  return new Promise(resolve => {
    try {
      if (message?.action === 'ytGetChannelInfo') {
        // Let the YouTube-specific listener handle this.
        // Resolve with no value to indicate we are not handling it here.
        resolve(undefined);
        return;
      }

      switch (message?.action) {
        case 'startScrolling':
          initScrollVars();
          startScrolling();
          resolve({ status: 'Scrolling started' });
          break;
        case 'stopScrolling':
          stopScrolling();
          resolve({ status: 'Scrolling stopped' });
          break;
        case 'resumeScrolling':
          startScrolling();
          resolve({ status: 'Scrolling resumed' });
          break;
        case 'scrollToBottom':
          scrollToBottom();
          resolve({ status: 'Scrolling once' });
          break;
        case 'collectAllVideoLinks': {
          const allLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a'))
            .map(a => a.href)
            .filter(href => /^https:\/\/www\.tiktok\.com\/[^/]+\/video\/\d+/.test(href));
          resolve({ links: allLinks });
          break;
        }
        case 'startSelectionMode':
          selectionMode = true;
          selectedAnchors.forEach(a => a.classList.remove('my-ext-selected'));
          selectedAnchors.clear();
          resolve({ status: 'Selection mode started' });
          break;
        case 'validateSelection': {
          const links = Array.from(selectedAnchors).map(a => a.href);
          selectedAnchors.forEach(a => a.classList.remove('my-ext-selected'));
          selectedAnchors.clear();
          selectionMode = false;
          resolve({ status: 'Selection validated', links });
          break;
        }
        case 'cancelSelection':
          selectedAnchors.forEach(a => a.classList.remove('my-ext-selected'));
          selectedAnchors.clear();
          selectionMode = false;
          resolve({ status: 'Selection canceled' });
          break;
        case 'startInstagramScrolling':
          initScrollVars();
          startScrolling();
          resolve({ status: 'Instagram scrolling started' });
          break;
        case 'startYouTubeScrolling':
          initScrollVars();
          startScrolling();
          resolve({ status: 'YouTube scrolling started' });
          break;
        case 'collectInstagramPostLinks': {
          const { links, items } = collectInstagramPostLinks();
          resolve({ links, items });
          break;
        }
        case 'collectTiktokFavoritesLinks': {
          const links = Array.from(collectedTiktokFavLinks);
          resolve({ links });
          break;
        }
        case 'resetTiktokFavoritesState':
          collectedTiktokFavLinks.clear();
          resolve({ status: 'cleared' });
          break;
        case 'collectYouTubeChannelVideos': {
          const links = Array.from(collectedYouTubeLinks);
          resolve({ links });
          break;
        }
        case 'scanTiktokFavoritesOnce': {
          const links = scanAndCollectTiktokFavorites(true);
          resolve({ links });
          break;
        }
        case 'detectTiktokSection': {
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
            resolve({ username, section });
          } catch {
            resolve({ username: '', section: 'unknown' });
          }
          break;
        }

        /** NEW: Pinterest helpers */
        case 'collectPinterestLinks': {
          const links = Array.from(collectedPinterestLinks);
          resolve({ links });
          break;
        }
        case 'resetPinterestState':
          collectedPinterestLinks.clear();
          resolve({ status: 'cleared' });
          break;
        case 'scanPinterestOnce': {
          const links = scanAndCollectPinterestPins(true);
          resolve({ links });
          break;
        }

        case 'ping':
          resolve({ status: 'pong' });
          break;
        default:
          // Unhandled action: resolve with undefined to let other listeners try.
          resolve(undefined);
          break;
      }
    } catch (e) {
      resolve({ error: String(e) });
    }
  });
});


// Initialize optional app integrations (safe on non-YouTube hosts)
try { initYouTubeContent(); } catch {}
try { initPinterestContent(); } catch {}
