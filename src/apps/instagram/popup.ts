import browser from 'webextension-polyfill';

export function extractInstagramCollectionName(url: string) {
  const savedMatch = url.match(/https:\/\/www\.instagram\.com\/([^/]+)\/saved\/([^/]+)\//);
  if (savedMatch && savedMatch[2]) {
    return savedMatch[2];
  }
  const profileMatch = url.match(/https:\/\/www\.instagram\.com\/([^/]+)\/(?:reels\/)?/);
  if (profileMatch && profileMatch[1]) {
    return profileMatch[1];
  }
  return 'my_collection';
}

export function getInstagramPageTitle(url: string) {
  const savedPageMatch = url.match(/https:\/\/www\.instagram\.com\/([^/]+)\/saved\/([^/]+)\/?/);
  if (savedPageMatch && savedPageMatch[2]) {
    return `Bookmarks: ${savedPageMatch[2]}`;
  }
  try {
    const u = new URL(url);
    const firstSeg = u.pathname.split('/').filter(Boolean)[0];
    if (firstSeg) {
      return `Instagram Page: ${firstSeg}`;
    }
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname.replace(/\/$/, '');
    if (path) return `Instagram Page: ${host}${path}`;
  } catch {}
  return 'Instagram Page';
}

export function getInstagramTypeAndHandle(url: string) {
  const savedMatch = url.match(/https:\/\/www\.instagram\.com\/([^/]+)\/saved\/([^/]+)\//);
  if (savedMatch && savedMatch[2]) {
    return { type: 'bookmarks' as const, handle: savedMatch[2] };
  }
  try {
    const u = new URL(url);
    const firstSeg = u.pathname.split('/').filter(Boolean)[0];
    if (firstSeg) {
      return { type: 'profile' as const, handle: firstSeg };
    }
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname.replace(/\/$/, '');
    return { type: 'profile' as const, handle: `${host}${path}` };
  } catch {
    return { type: 'profile' as const, handle: url.replace(/^https?:\/\//, '').replace(/^www\./, '') };
  }
}

export async function onInstagramScrollComplete(deps: {
  activeUrl: string;
  isInstagramDomain: boolean;
  addBookmarksToCollection: (platform: 'instagram', collectionName: string, urls: string[]) => void;
}) {
  const { activeUrl, isInstagramDomain, addBookmarksToCollection } = deps;
  if (!isInstagramDomain) return;
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (tabId == null) return;
  const response = await browser.tabs.sendMessage(tabId, { action: 'collectInstagramPostLinks' }).catch(() => null) as any;
  if (!response || !response.links) return;
  let collectionName = extractInstagramCollectionName(activeUrl);
  if (activeUrl.includes('/saved/all-posts/')) {
    collectionName = 'all-posts';
  } else {
    const promptName = prompt('Enter a name for this collection:', collectionName);
    if (promptName) {
      collectionName = promptName;
    } else {
      return;
    }
  }
  addBookmarksToCollection('instagram', collectionName, response.links);
}

export async function handleInstagramScrollAndCollect(deps: {
  activeUrl: string;
  ensureCollection: (platform: 'instagram', collectionName: string, meta?: { type: 'bookmarks' | 'profile'; handle: string }) => void;
  startInstagramScrolling: () => void;
  pingContentScript: (tabId: number) => Promise<boolean>;
}) {
  const { activeUrl, ensureCollection, startInstagramScrolling, pingContentScript } = deps;
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (tabId == null) {
    console.error('No active tab found.');
    return;
  }
  const isContentScriptReady = await pingContentScript(tabId);
  if (!isContentScriptReady) {
    console.error('Content script is not ready. Cannot start scrolling.');
    alert('The content script is not active on this page. Please refresh the page and try again.');
    return;
  }
  let collectionName = extractInstagramCollectionName(activeUrl);
  if (activeUrl.includes('/saved/all-posts/')) {
    collectionName = 'all-posts';
  }
  const meta = getInstagramTypeAndHandle(activeUrl);
  ensureCollection('instagram', collectionName, { type: meta.type, handle: meta.handle });
  setTimeout(() => {
    startInstagramScrolling();
  }, 500);
}


