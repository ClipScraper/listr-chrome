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
  setActiveCollection: (info: { name: string; handle: string } | null) => void;
}) {
  const { activeUrl, ensureCollection, addBookmarksToCollection, startScrolling, pingContentScript, setActiveCollection } = deps;
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

  // Detect bookmark category from page heading
  let collectionHandle = 'Bookmarks';
  const infoResponse = await browser.tabs.sendMessage(tabId, { action: 'getTwitterBookmarkInfo' }).catch(() => null) as any;
  if (infoResponse?.category) {
    collectionHandle = infoResponse.category;
  }

  const collectionName = collectionHandle;
  ensureCollection('twitter', collectionName, { type: 'bookmarks', handle: collectionHandle });
  setActiveCollection({ name: collectionName, handle: collectionHandle });

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
  activeCollectionName: string | null;
}) {
  const { activeUrl, isTwitterDomain, addBookmarksToCollection, activeCollectionName } = deps;
  if (!isTwitterDomain) return;
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (tabId == null) return;
  const response = await browser.tabs.sendMessage(tabId, { action: 'collectTwitterTweets' }).catch(() => null) as any;
  if (!response || !response.items) return;
  const items = response.items as Array<{ url: string }>;
  const collectionName = activeCollectionName || 'Bookmarks';
  addBookmarksToCollection('twitter', collectionName, items.map(item => item.url));
}

export function isTwitterThreadPage(url: string): boolean {
  try {
    const u = new URL(url);
    const pathParts = u.pathname.split('/').filter(Boolean);
    // Pattern: /{username}/status/{id}
    return pathParts.length === 3 && pathParts[1] === 'status' && /^\d+$/.test(pathParts[2]);
  } catch {
    return false;
  }
}

export async function handleTwitterThreadDownload(deps: {
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
    console.error('Content script is not ready. Cannot download thread.');
    alert('The content script is not active on this page. Please refresh the page and try again.');
    return;
  }
  
  // Extract thread ID from URL
  try {
    const u = new URL(activeUrl);
    const pathParts = u.pathname.split('/').filter(Boolean);
    const threadId = pathParts[2]; // /{username}/status/{id}
    
    if (!threadId) {
      alert('Could not determine thread ID from URL.');
      return;
    }
    
    // Reset Twitter state before starting
    await browser.tabs.sendMessage(tabId, { action: 'resetTwitterState' }).catch(() => null);
    
    // Create collection name from thread ID
    const collectionName = `Thread_${threadId}`;
    ensureCollection('twitter', collectionName, { type: 'bookmarks', handle: `Thread ${threadId}` });
    
    // Start collecting thread replies
    await browser.tabs.sendMessage(tabId, { action: 'startTwitterThreadCollection', threadId }).catch(() => null);
    
    // Do an initial scan
    const response = await browser.tabs.sendMessage(tabId, { action: 'scanTwitterThreadOnce', threadId }).catch(() => null) as any;
    const items = (response?.items || []) as Array<{ url: string; userHandle: string; userName: string; text: string }>;
    if (items && items.length > 0) {
      addBookmarksToCollection('twitter', collectionName, items.map(item => item.url));
    }
    
    setTimeout(() => {
      startScrolling();
    }, 500);
  } catch (error) {
    console.error('Error starting thread download:', error);
    alert('An error occurred while starting thread download.');
  }
}

