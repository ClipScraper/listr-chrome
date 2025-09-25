import browser from 'webextension-polyfill';

export type ActiveTikTokCollection = { name: string; type: 'bookmarks' | 'favorites' | 'liked' | 'reposts' | 'profile'; handle: string };

export const tiktokVideoRegex = /^https:\/\/www\.tiktok\.com\/[^/]+\/(?:video|photo)\/\d+/;

export function getTiktokPageTitle(url: string, sectionState?: { username: string; section: string } | null) {
  const usernameMatch = url.match(/https:\/\/www\.tiktok\.com\/@([^/]+)/);
  const username = usernameMatch?.[1];
  const collectionMatch = url.match(/https:\/\/www\.tiktok\.com\/@[^/]+\/collection\/([^\/?#]+)/);
  let sectionLabel = '';
  if (sectionState && username) {
    if (sectionState.section === 'favorites') sectionLabel = ' Favorites';
    else if (sectionState.section === 'liked') sectionLabel = ' Liked';
    else if (sectionState.section === 'reposts') sectionLabel = ' Reposts';
  }
  if (collectionMatch && collectionMatch[1]) {
    const slug = decodeURIComponent(collectionMatch[1]);
    const pretty = slug.replace(/-[0-9]+$/, '');
    return `TikTok Collection: ${pretty}`;
  }
  if (username) return `TikTok Page: ${username}${sectionLabel}`;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname.replace(/\/$/, '');
    return `TikTok Page: ${host}${path}`;
  } catch {
    return 'TikTok Page';
  }
}

export async function detectTiktokSectionOnActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (tabId == null) return null;
  const res = await browser.tabs.sendMessage(tabId, { action: 'detectTiktokSection' }).catch(() => null);
  return res as any;
}

export async function bookmarkCurrentVideo(deps: { activeUrl: string; addBookmarksToCollection: (platform: 'tiktok', collectionName: string, urls: string[]) => void; }) {
  const { activeUrl, addBookmarksToCollection } = deps;
  const isVideoPage = tiktokVideoRegex.test(activeUrl);
  if (!isVideoPage) {
    alert('Not a valid TikTok video page.');
    return;
  }
  addBookmarksToCollection('tiktok', 'single_bookmarks', [activeUrl]);
}

export async function bookmarkAllOnPage(deps: { addBookmarksToCollection: (platform: 'tiktok', collectionName: string, urls: string[]) => void; }) {
  const { addBookmarksToCollection } = deps;
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (tabId == null) return;
  const response = await browser.tabs.sendMessage(tabId, { action: 'collectAllVideoLinks' }).catch(() => null) as any;
  if (!response) return;
  const res = response as { links: string[] };
  if (res.links) {
    addBookmarksToCollection('tiktok', 'all_tiktok_links', res.links);
  }
}

type ScrollStatus = 'idle' | 'scrolling' | 'paused';

export async function collectTiktokFavoritesFlow(deps: {
  activeUrl: string;
  ensureCollection: (platform: 'tiktok', collectionName: string, meta?: { type: ActiveTikTokCollection['type']; handle: string }) => void;
  addBookmarksToCollection: (platform: 'tiktok', collectionName: string, urls: string[]) => void;
  setActiveCollection: (active: ActiveTikTokCollection | null) => void;
  pingContentScript: (tabId: number) => Promise<boolean>;
  scrollStatus: ScrollStatus;
  startScrolling: () => void;
}) {
  const { activeUrl, ensureCollection, addBookmarksToCollection, setActiveCollection, pingContentScript, scrollStatus, startScrolling } = deps;
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (tabId == null) return;
  await browser.tabs.sendMessage(tabId, { action: 'resetTiktokFavoritesState' }).catch(() => null);
  const ctx = await browser.tabs.sendMessage(tabId, { action: 'detectTiktokSection' }).catch(() => null) as any;
  const username = (ctx?.username || (activeUrl.match(/https:\/\/www\.tiktok\.com\/@([^/]+)/)?.[1])) || 'unknown';
  const section = (ctx?.section as string) || 'favorites';
  const collectionMatch = activeUrl.match(/https:\/\/www\.tiktok\.com\/@[^/]+\/collection\/([^\/?#]+)/);

  let collectionName: string;
  let metaType: ActiveTikTokCollection['type'] = 'bookmarks';
  let handle: string = 'unsorted';

  if (collectionMatch && collectionMatch[1]) {
    const slug = collectionMatch[1];
    const pretty = slug.replace(/-[0-9]+$/, '');
    collectionName = `collection_${username}_${pretty}`;
    metaType = 'bookmarks';
    handle = pretty || slug;
  } else if (/videos?/i.test(section)) {
    collectionName = `${username}_profile`;
    metaType = 'profile';
    handle = username;
  } else if (/liked/i.test(section)) {
    collectionName = `${username}_liked`;
    metaType = 'liked';
    handle = username;
  } else if (/reposts?/i.test(section)) {
    collectionName = `${username}_reposts`;
    metaType = 'reposts';
    handle = username;
  } else {
    collectionName = `unsorted`;
    metaType = 'bookmarks';
    handle = 'unsorted';
  }

  setActiveCollection({ name: collectionName, type: metaType, handle });
  ensureCollection('tiktok', collectionName, { type: metaType, handle });

  const response = await browser.tabs.sendMessage(tabId, { action: 'scanTiktokFavoritesOnce' }).catch(() => null);
  const links = (response && (response as any).links) as string[] | undefined;
  if (links && links.length > 0) {
    addBookmarksToCollection('tiktok', collectionName, links);
  }

  const isContentScriptReady = await pingContentScript(tabId);
  if (!isContentScriptReady) {
    alert('The content script is not active on this page. Please refresh and try again.');
    return;
  }
  if (scrollStatus === 'idle') {
    startScrolling();
  }
}


