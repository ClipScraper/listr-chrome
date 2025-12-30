import browser from 'webextension-polyfill';

export function getTwitterPageTitle(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'x.com' || host === 'twitter.com') {
      return 'Twitter/X Bookmarks';
    }
    return 'Twitter/X';
  } catch {
    return 'Twitter/X';
  }
}

type ScrollStatus = 'idle' | 'scrolling' | 'paused';

export async function handleTwitterScrollAndCollect(deps: {
  activeUrl: string;
  ensureCollection: (platform: 'twitter', collectionName: string, meta?: { type: 'bookmarks' | 'profile'; handle: string }) => void;
  addBookmarksToCollection: (platform: 'twitter', collectionName: string, urls: string[]) => void;
  startScrolling: () => void;
  pingContentScript: (tabId: number) => Promise<boolean>;
}) {
  const { activeUrl, ensureCollection, addBookmarksToCollection, startScrolling, pingContentScript } = deps;
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
  
  // Reset Twitter state before starting
  await browser.tabs.sendMessage(tabId, { action: 'resetTwitterState' }).catch(() => null);
  
  // Twitter/X bookmarks collection
  const collectionName = 'Bookmarks';
  ensureCollection('twitter', collectionName, { type: 'bookmarks', handle: 'Bookmarks' });
  
  // Do an initial scan
  const response = await browser.tabs.sendMessage(tabId, { action: 'scanTwitterOnce' }).catch(() => null) as any;
  const items = (response?.items || []) as Array<{ url: string; userHandle: string; userName: string; text: string }>;
  if (items && items.length > 0) {
    addBookmarksToCollection('twitter', collectionName, items.map(item => item.url));
  }
  
  setTimeout(() => {
    startScrolling();
  }, 500);
}

export async function onTwitterScrollComplete(deps: {
  activeUrl: string;
  isTwitterDomain: boolean;
  addBookmarksToCollection: (platform: 'twitter', collectionName: string, urls: string[]) => void;
}) {
  const { activeUrl, isTwitterDomain, addBookmarksToCollection } = deps;
  if (!isTwitterDomain) return;
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (tabId == null) return;
  const response = await browser.tabs.sendMessage(tabId, { action: 'collectTwitterTweets' }).catch(() => null) as any;
  if (!response || !response.items) return;
  const items = response.items as Array<{ url: string }>;
  const collectionName = 'Bookmarks';
  addBookmarksToCollection('twitter', collectionName, items.map(item => item.url));
}

