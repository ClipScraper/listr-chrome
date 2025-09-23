import browser from 'webextension-polyfill';

console.log("Content script loaded.");

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

function scanAndCollectTiktokFavorites(logEach: boolean = false): string[] {
  if (!/\.tiktok\.com$/.test(location.hostname)) return [];
  const newly: string[] = [];

  let selector = '';
  if (isOnTiktokFavoritesPage()) {
    selector = '[data-e2e="favorites-item"] a[href^="https://www.tiktok.com/"]';
  } else if (isOnTiktokCollectionPage()) {
    // Collection pages: grid cards do not have favorites-item; target the card container aria-label
    selector = 'div[aria-label="Watch in full screen"] a[href^="https://www.tiktok.com/"]';
  } else {
    // Generic profile tabs (liked/reposts): use the visible grid card pattern
    selector = 'div[aria-label="Watch in full screen"] a[href^="https://www.tiktok.com/"]';
  }

  // Constrain scope to the collection root when on a collection page to avoid
  // picking up links from headers/popups (e.g., inbox) elsewhere in the DOM
  const scopeEl: Document | Element = isOnTiktokCollectionPage() && getTiktokCollectionRoot()
    ? (getTiktokCollectionRoot() as HTMLElement)
    : document;

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
 * Single message listener
 */
browser.runtime.onMessage.addListener((message: any, _sender: any, sendResponse: any) => {
  if (message.action === "startScrolling") {
    initScrollVars();
    startScrolling();
    sendResponse({ status: "Scrolling started" });
  } 
  else if (message.action === "stopScrolling") {
    stopScrolling();
    sendResponse({ status: "Scrolling stopped" });
  }
  else if (message.action === "resumeScrolling") {
    startScrolling();
    sendResponse({ status: "Scrolling resumed" });
  }
  else if (message.action === "scrollToBottom") {
    scrollToBottom();
    sendResponse({ status: "Scrolling once" });
  }
  else if (message.action === "collectAllVideoLinks") {
    // "Bookmark All" approach
    const allLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>("a"));
    const matched = allLinks
      .map(a => a.href)
      .filter(href => /^https:\/\/www\.tiktok\.com\/[^/]+\/video\/\d+/.test(href));
    sendResponse({ links: matched });
  }
  // NEW: selection mode
  else if (message.action === "startSelectionMode") {
    selectionMode = true;
    // clear old selection
    selectedAnchors.forEach(a => a.classList.remove('my-ext-selected'));
    selectedAnchors.clear();
    sendResponse({ status: "Selection mode started" });
  }
  else if (message.action === "validateSelection") {
    // gather href from selected anchors
    const links = Array.from(selectedAnchors).map(a => a.href);
    // remove overlays
    selectedAnchors.forEach(a => a.classList.remove('my-ext-selected'));
    selectedAnchors.clear();
    selectionMode = false;
    sendResponse({ status: "Selection validated", links });
  }
  else if (message.action === "cancelSelection") {
    // remove overlays
    selectedAnchors.forEach(a => a.classList.remove('my-ext-selected'));
    selectedAnchors.clear();
    selectionMode = false;
    sendResponse({ status: "Selection canceled" });
  }
  else if (message.action === "startInstagramScrolling") {
    initScrollVars();
    startScrolling();
    sendResponse({ status: "Instagram scrolling started" });
  }
  else if (message.action === "collectInstagramPostLinks") {
    const { links, items } = collectInstagramPostLinks();
    sendResponse({ links, items });
  }
  else if (message.action === "collectTiktokFavoritesLinks") {
    const links = Array.from(collectedTiktokFavLinks);
    sendResponse({ links });
  }
  else if (message.action === "resetTiktokFavoritesState") {
    collectedTiktokFavLinks.clear();
    sendResponse({ status: 'cleared' });
  }
  else if (message.action === "scanTiktokFavoritesOnce") {
    const links = scanAndCollectTiktokFavorites(true);
    sendResponse({ links });
  }
  else if (message.action === "detectTiktokSection") {
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
      sendResponse({ username, section });
    } catch {
      sendResponse({ username: '', section: 'unknown' });
    }
  }
  else if (message.action === "ping") {
    sendResponse({ status: "pong" });
  }

  return true;
});

browser.runtime.onMessage.addListener((message: any) => {
  if (message.action === 'extensionData') {
    window.postMessage({ source: 'myExtension', payload: message.payload }, '*');
  }
});


