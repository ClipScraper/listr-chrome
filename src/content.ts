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


