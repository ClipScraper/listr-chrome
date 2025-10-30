import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Sun, Moon, Download, Ban, ListTodo, Play, Pause, Trash2, Plus, Settings } from 'lucide-react';
import browser from 'webextension-polyfill';
import { useActiveTab } from './hooks/useActiveTab';
import { useScrolling } from './hooks/useScrolling';
import { useSelectionMode } from './hooks/useSelectionMode';
import { useCollections } from './hooks/useCollections';
import './styles/popup.css';
import {
  extractInstagramCollectionName,
  getInstagramPageTitle as igGetInstagramPageTitle,
  handleInstagramScrollAndCollect as iHandleInstagramScrollAndCollect,
  onInstagramScrollComplete as iOnInstagramScrollComplete,
} from './apps/instagram/popup';
import {
  getTiktokPageTitle as iGetTiktokPageTitle,
  collectTiktokFavoritesFlow,
  ActiveTikTokCollection,
  detectTiktokSectionOnActiveTab,
} from './apps/tiktok/popup';
import { getYouTubePageTitle } from './apps/youtube/popup';

interface ContentScriptPingResponse {
  status: "pong";
}

// Helper: derive a Pinterest title just from the URL.
// We still ask the content script for the selected tab ONLY on the homepage.
function getPinterestPageTitleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!/pinterest\./.test(u.hostname)) return 'Pinterest';
    const segs = u.pathname.split('/').filter(Boolean);

    // Home
    if (segs.length === 0) return 'Pinterest';

    // Pin page
    if (segs[0] === 'pin' && segs[1]) {
      return `Pinterest pin - ${segs[1]}`;
    }

    // Search
    if (segs[0] === 'search' && segs[1] === 'pins') {
      const q = u.searchParams.get('q') || '';
      const query = q ? decodeURIComponent(q) : 'pins';
      return `Pinterest search - ${query}`;
    }

    // Board (also handles .../<board>/pins)
    if (segs.length >= 2) {
      const user = decodeURIComponent(segs[0]);
      const board = decodeURIComponent(segs[1]);
      return `Pinterest: ${user} - ${board}`;
    }

    // Profile
    if (segs.length === 1) {
      const user = decodeURIComponent(segs[0]);
      return `Pinterest profile - ${user}`;
    }

    return 'Pinterest';
  } catch {
    return 'Pinterest';
  }
}

// Function to ping the content script and check if it's active
async function pingContentScript(tabId: number): Promise<boolean> {
  try {
    const response = await browser.tabs.sendMessage(tabId, { action: "ping" }) as ContentScriptPingResponse;
    return response?.status === "pong";
  } catch (error) {
    console.warn("Content script not reachable (ping failed):", error);
    return false;
  }
}

const Popup: React.FC = () => {
  const { activeUrl } = useActiveTab();
  const { collectionStore, addBookmarksToCollection, deleteCollection, renameCollection, getAllCollections, ensureCollection, getCollectionMeta } = useCollections();
  const { isSelecting, startSelectionMode, validateSelection, cancelSelection } = useSelectionMode((urls) => addBookmarksToCollection('tiktok', 'selected_tiktok_links', urls));

  const [isDarkMode, setIsDarkMode] = React.useState(false);
  const toggleTheme = () => setIsDarkMode(prev => !prev);

  // TikTok section detection
  const [tiktokSectionState, setTiktokSectionState] = React.useState<{ username: string; section: string } | null>(null);
  const tiktokActiveCollectionRef = React.useRef<{ name: string; type: 'bookmarks' | 'favorites' | 'liked' | 'reposts' | 'profile'; handle: string } | null>(null);
  const youtubeCurrentCollection = React.useRef<string | null>(null);
  const tiktokPollIntervalRef = React.useRef<number | null>(null);

  /** NEW: Pinterest active collection ref */
  const pinterestActiveRef = React.useRef<{ name: string; type: 'bookmarks' | 'profile'; handle: string } | null>(null);

  const isTikTokDomain = activeUrl.startsWith("https://www.tiktok.com");
  const isInstagramDomain = activeUrl.startsWith("https://www.instagram.com");
  const isYouTubeDomain = /^https:\/\/www\.youtube\./.test(activeUrl);
  const isPinterestDomain = /^https:\/\/(?:[^\/]+\.)?pinterest\./.test(activeUrl);

  // Detect homepage precisely
  const isPinterestRoot = React.useMemo(() => {
    try {
      const u = new URL(activeUrl);
      return isPinterestDomain && u.pathname === '/';
    } catch {
      return false;
    }
  }, [activeUrl, isPinterestDomain]);

  const isYouTubeVideoPage = isYouTubeDomain && activeUrl.includes('/watch?v=');
  const isYouTubePlaylistPage = isYouTubeDomain && activeUrl.includes('/playlist?list=');
  const isYouTubeChannelPage =
    isYouTubeDomain &&
    (activeUrl.includes('/videos') ||
      activeUrl.includes('/shorts') ||
      activeUrl.includes('/streams') ||
      /youtube\.com\/(user\/|@|channel\/)/.test(activeUrl));

  const [youTubeTitle, setYouTubeTitle] = React.useState<string>(() => getYouTubePageTitle(activeUrl));
  const [youTubeErrorMessage, setYouTubeErrorMessage] = React.useState<string>('');
  const [pinterestTitle, setPinterestTitle] = React.useState<string>('Pinterest');
  const [isSettingsOpen, setIsSettingsOpen] = React.useState<boolean>(false);
  const [editingCollection, setEditingCollection] = React.useState<{platform: string, collectionName: string} | null>(null);
  const [editingValue, setEditingValue] = React.useState<string>('');
  const [validateBeforeClear, setValidateBeforeClear] = React.useState<boolean>(true);
  const [scrollWaitTime, setScrollWaitTime] = React.useState<number>(3);
  const [downloadFormat, setDownloadFormat] = React.useState<'csv' | 'json'>('csv');


  React.useEffect(() => {
    browser.storage.local.get(['validateBeforeClear', 'scrollWaitTime', 'downloadFormat']).then(result => {
      if (typeof result.validateBeforeClear === 'boolean') {
        setValidateBeforeClear(result.validateBeforeClear);
      }
      if (typeof result.scrollWaitTime === 'number') {
        setScrollWaitTime(result.scrollWaitTime);
      }
      if (result.downloadFormat === 'csv' || result.downloadFormat === 'json') {
        setDownloadFormat(result.downloadFormat);
      }
    });
  }, []);

  const handleSetValidateBeforeClear = (value: boolean) => {
    setValidateBeforeClear(value);
    browser.storage.local.set({ validateBeforeClear: value });
  };

  const handleSetScrollWaitTime = (value: string) => {
    const num = parseInt(value, 10);
    if (!isNaN(num) && num >= 0) {
      setScrollWaitTime(num);
      browser.storage.local.set({ scrollWaitTime: num });
    }
  };

  const handleSetDownloadFormat = (value: string) => {
    if (value === 'csv' || value === 'json') {
      setDownloadFormat(value);
      browser.storage.local.set({ downloadFormat: value });
    }
  };

  const onInstaCompleteCb = React.useCallback(() => iOnInstagramScrollComplete({
    activeUrl,
    isInstagramDomain,
    addBookmarksToCollection,
  }), [activeUrl, isInstagramDomain]);

  const { scrollStatus, timeRemaining, startScrolling, stopResumeScrolling, startInstagramScrolling, startYouTubeScrolling, cancelScrolling } = useScrolling(onInstaCompleteCb);

  React.useEffect(() => {
    if (!isTikTokDomain) {
      setTiktokSectionState(null);
      return;
    }
    detectTiktokSectionOnActiveTab()
      .then(res => { if (res) setTiktokSectionState(res as any); })
      .catch(() => {});
  }, [activeUrl]);

  // Pinterest: compute a title on *all* pages, and only on "/" try to enrich with the selected tab label.
  React.useEffect(() => {
    if (!isPinterestDomain) {
      setPinterestTitle('Pinterest');
      return;
    }

    const base = getPinterestPageTitleFromUrl(activeUrl);

    if (!isPinterestRoot) {
      setPinterestTitle(base);
      return;
    }

    (async () => {
      try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs[0]?.id;
        if (!tabId) {
          setPinterestTitle(base);
          return;
        }
        const res = await browser.tabs.sendMessage(tabId, { action: 'pinterestGetSection' }).catch(() => null) as any;
        const section = (res?.section || '').trim();
        if (section) {
          setPinterestTitle(`Pinterest - ${section}`);
        } else {
          setPinterestTitle(base);
        }
      } catch {
        setPinterestTitle(base);
      }
    })();
  }, [activeUrl, isPinterestDomain, isPinterestRoot]);

  // --- listen for pushes from the YouTube content script
  React.useEffect(() => {
    const onMsg = (message: any) => {
      if (message?.type === 'ytChannelInfoPush') {
        const info = message.payload || {};
        const name = (info.name || '').trim();
        const handle = (info.handle || '').trim();
        if (name) {
          setYouTubeTitle(`YouTube Channel: ${name}`);
        } else if (handle) {
          setYouTubeTitle(`YouTube Channel: ${handle}`);
        }
      }
    };
    browser.runtime.onMessage.addListener(onMsg);
    return () => browser.runtime.onMessage.removeListener(onMsg);
  }, []);

  // Request YouTube channel info whenever we open the popup on a YouTube page
  React.useEffect(() => {
    if (!isYouTubeDomain) return;

    (async () => {
      try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs[0]?.id;
        if (tabId == null) {
          setYouTubeTitle(getYouTubePageTitle(activeUrl));
          return;
        }
        const res = await browser.tabs.sendMessage(tabId, { action: 'ytGetChannelInfo' })
          .catch(() => null) as any;

        const name = (res?.name || '').trim();
        const handle = (res?.handle || '').trim();

        if (name) {
          setYouTubeTitle(`YouTube Channel: ${name}`);
        } else if (handle) {
          setYouTubeTitle(`YouTube Channel: ${handle}`);
        } else {
          setYouTubeTitle(getYouTubePageTitle(activeUrl));
        }
      } catch {
        setYouTubeTitle(getYouTubePageTitle(activeUrl));
      }
    })();
  }, [activeUrl, isYouTubeDomain]);

  // While scrolling on TikTok, poll periodically for newly found links
  React.useEffect(() => {
    if (!isTikTokDomain || !tiktokActiveCollectionRef.current) {
      if (tiktokPollIntervalRef.current) {
        window.clearInterval(tiktokPollIntervalRef.current);
        tiktokPollIntervalRef.current = null;
      }
      return;
    }
    if (scrollStatus === 'idle') {
      if (tiktokPollIntervalRef.current) {
        window.clearInterval(tiktokPollIntervalRef.current);
        tiktokPollIntervalRef.current = null;
      }
      return;
    }
    if (tiktokPollIntervalRef.current) return;
    tiktokPollIntervalRef.current = window.setInterval(async () => {
      try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs[0]?.id;
        if (tabId == null) return;
        const response = await browser.tabs.sendMessage(tabId, { action: 'collectTiktokFavoritesLinks' }).catch(() => null) as any;
        const links = (response?.links || []) as string[];
        const active = tiktokActiveCollectionRef.current;
        if (!active || !links || links.length === 0) return;
        ensureCollection('tiktok', active.name, { type: active.type, handle: active.handle });
        addBookmarksToCollection('tiktok', active.name, links);
      } catch {}
    }, 1500);
    return () => {
      if (tiktokPollIntervalRef.current) {
        window.clearInterval(tiktokPollIntervalRef.current);
        tiktokPollIntervalRef.current = null;
      }
    };
  }, [scrollStatus, isTikTokDomain]);

  // Clear YouTube error message when URL changes or collections exist
  React.useEffect(() => {
    if (youTubeErrorMessage && (Object.keys(getAllCollections()).length > 0 || !isYouTubeDomain)) {
      setYouTubeErrorMessage('');
    }
  }, [activeUrl, getAllCollections, isYouTubeDomain, youTubeErrorMessage]);

  React.useEffect(() => {
    const handler = (message: any) => {
      if (message.type === 'instaNewLinks') {
        if (!isInstagramDomain) return;
        let collectionName = extractInstagramCollectionName(activeUrl);
        if (activeUrl.includes('/saved/all-posts/')) {
          collectionName = 'all-posts';
        }
        const links: string[] = message.links || [];
        if (links.length > 0) {
          addBookmarksToCollection('instagram', collectionName, links);
        }
      }
      if (message.type === 'tiktokNewLinks') {
        if (!isTikTokDomain) return;
        const links: string[] = message.links || [];
        if (links.length === 0) return;
        const active = tiktokActiveCollectionRef.current;
        if (active) {
          ensureCollection('tiktok', active.name, { type: active.type, handle: active.handle });
          addBookmarksToCollection('tiktok', active.name, links);
          return;
        }
        const usernameMatch = activeUrl.match(/https:\/\/www\.tiktok\.com\/@([^/]+)/);
        const username = usernameMatch?.[1] || 'unsorted';
        const fallbackName = `${username}_profile`;
        ensureCollection('tiktok', fallbackName, { type: 'profile', handle: username });
        addBookmarksToCollection('tiktok', fallbackName, links);
      }
      if (message.type === 'youtubeNewLinks') {
        if (!isYouTubeDomain) return;
        const links: string[] = message.links || [];
        if (links.length > 0) {
          (async () => {
            try {
              if (isYouTubePlaylistPage) {
                const tabs = await browser.tabs.query({ active: true, currentWindow: true });
                const tabId = tabs[0]?.id;
                if (!tabId) return;

                const res = await browser.tabs.sendMessage(tabId, { action: 'ytGetPlaylistInfo' }) as { playlistName: string };
                const playlistName = res?.playlistName.trim();
                if (playlistName) {
                  const collectionName = `${playlistName}_playlist`;
                  addBookmarksToCollection('youtube', collectionName, links);
                }
              } else if (youtubeCurrentCollection.current) {
                addBookmarksToCollection('youtube', youtubeCurrentCollection.current, links);
              }
            } catch {}
          })();
        }
      }

      /** Pinterest incremental push */
      if (message.type === 'pinterestNewLinks') {
        if (!isPinterestDomain) return;
        const links: string[] = message.links || [];
        if (links.length === 0) return;

        const active = pinterestActiveRef.current;
        if (active) {
          ensureCollection('pinterest', active.name, { type: active.type, handle: active.handle });
          addBookmarksToCollection('pinterest', active.name, links);
          return;
        }
        ensureCollection('pinterest', 'pinterest_page', { type: 'profile', handle: 'Pinterest' });
        addBookmarksToCollection('pinterest', 'pinterest_page', links);
      }
    };
    browser.runtime.onMessage.addListener(handler);
    return () => browser.runtime.onMessage.removeListener(handler);
  }, [activeUrl, isPinterestDomain, isTikTokDomain, isInstagramDomain, isYouTubeDomain, isYouTubePlaylistPage]);

  const handleBookmarkAll = () => {
    browser.tabs.query({ active: true, currentWindow: true })
      .then(tabs => {
        const tabId = tabs[0]?.id;
        if (tabId != null) {
          return browser.tabs.sendMessage(tabId, { action: "collectAllVideoLinks" });
        }
      })
      .then(response => {
        if (!response) return;
        const res = response as { links: string[] };
        if (res.links) {
          addBookmarksToCollection('tiktok', 'all_tiktok_links', res.links);
        }
      })
      .catch(err => console.error("Error collecting video links:", err));
  };

  const handleCollectTiktokFavorites = React.useCallback(async () => {
    await collectTiktokFavoritesFlow({
      activeUrl,
      ensureCollection: (platform, name, meta) => ensureCollection(platform, name, meta as any),
      addBookmarksToCollection,
      setActiveCollection: (active: ActiveTikTokCollection | null) => { tiktokActiveCollectionRef.current = active; },
      pingContentScript,
      scrollStatus,
      startScrolling: () => startScrolling(scrollWaitTime),
    });
  }, [activeUrl, ensureCollection, addBookmarksToCollection, pingContentScript, scrollStatus, startScrolling, scrollWaitTime]);

  /** Pinterest list button handler */
  // FIXED: ensure /search/pins is handled BEFORE the generic 2-segment matcher
  // Pinterest: list pins on current page (search-first routing + strict TS-safe)
  const handleCollectPinterestPins = React.useCallback(async () => {
    try {
      const u = new URL(activeUrl);
      let collectionName = 'pinterest_page';
      let handle = 'Pinterest';
      let type: 'bookmarks' | 'profile' = 'profile';

      // 1) /search/pins?q=... (handle this BEFORE the generic 2-segment matcher)
      if (u.pathname.startsWith('/search/pins')) {
        const q = (u.searchParams.get('q') || '').trim();
        if (q) {
          collectionName = `search_${q}`;
          handle = `Search - ${q}`;
        } else {
          collectionName = 'search_pins';
          handle = 'Search - pins';
        }
        type = 'profile';

      // 2) Single pin
      } else if (/^\/pin\/(\d+)/.test(u.pathname)) {
        const id = (u.pathname.match(/^\/pin\/(\d+)/) || [, ''])[1];
        collectionName = `pin_${id}`;
        handle = `Pin ${id}`;
        type = 'bookmarks';

      // 3) Board: /{user}/{board} (runs after search so it won't swallow it)
      } else if (/^\/([^/]+)\/([^/]+)\/?/.test(u.pathname)) {
        const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/?/)!;
        const user = decodeURIComponent(m[1]);
        const board = decodeURIComponent(m[2]);
        collectionName = `${user}_${board}`;
        handle = `${user} - ${board}`;
        type = 'profile';

      // 4) Home: include selected section if available
      } else if (u.pathname === '/') {
        try {
          const tabs = await browser.tabs.query({ active: true, currentWindow: true });
          const tabId = tabs[0]?.id;

          // TS-safe: force `any` so strict mode won't complain about `.section`
          const res: any = tabId
            ? await (browser.tabs.sendMessage(tabId, { action: 'pinterestGetSection' }) as any)
                .catch(() => null)
            : null;

          const section = (res && typeof res.section === 'string') ? res.section.trim() : '';
          if (section) {
            collectionName = `home_${section}`;
            handle = section;
          } else {
            collectionName = 'home';
            handle = 'Home';
          }
        } catch {
          collectionName = 'home';
          handle = 'Home';
        }
      }

      // Ensure meta row and start incremental collection
      pinterestActiveRef.current = { name: collectionName, type, handle };
      ensureCollection('pinterest', collectionName, { type, handle });

      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (tabId) {
        await browser.tabs.sendMessage(tabId, { action: 'resetPinterestState' }).catch(() => null);
      }
      startScrolling(scrollWaitTime);
    } catch (e) {
      console.error('Error starting Pinterest collection:', e);
    }
  }, [activeUrl, ensureCollection, startScrolling, scrollWaitTime]);

  const handleCancelListing = () => {
    cancelScrolling();
    tiktokActiveCollectionRef.current = null;
    pinterestActiveRef.current = null;
    if (tiktokPollIntervalRef.current) {
      window.clearInterval(tiktokPollIntervalRef.current);
      tiktokPollIntervalRef.current = null;
    }
  };

  const startEditingCollection = (platform: string, collectionName: string) => {
    setEditingCollection({ platform, collectionName });
    setEditingValue(collectionName);
  };

  const saveCollectionEdit = () => {
    if (editingCollection && editingValue.trim() && editingValue.trim() !== editingCollection.collectionName) {
      renameCollection(editingCollection.platform, editingCollection.collectionName, editingValue.trim());
    }
    setEditingCollection(null);
    setEditingValue('');
  };

  const cancelCollectionEdit = () => {
    setEditingCollection(null);
    setEditingValue('');
  };

  const handleEditKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      saveCollectionEdit();
    } else if (e.key === 'Escape') {
      cancelCollectionEdit();
    }
  };

  // CSV helpers
  const escapeCsv = (value: string) => {
    const needsQuotes = /[",\n]/.test(value);
    const escaped = value.replace(/"/g, '""');
    return needsQuotes ? `"${escaped}"` : escaped;
  };

  const inferMediaType = (platform: string, url: string): 'video' | 'pictures' | 'unknown' => {
    if (platform === 'instagram') {
      if (/\/reel\//.test(url)) return 'video';
      if (/\/p\//.test(url)) return 'pictures';
      return 'unknown';
    }
    if (platform === 'tiktok') {
      if(/\/photo\//.test(url)) return 'pictures';
      return 'video';
    }
    if (platform === 'youtube') {
      return 'video';
    }
    if (platform === 'pinterest') {
      return 'pictures';
    }
    return 'unknown';
  };

  const handleInstagramScrollAndCollect = React.useCallback(() => iHandleInstagramScrollAndCollect({
    activeUrl,
    ensureCollection,
    startInstagramScrolling: () => startInstagramScrolling(scrollWaitTime),
    pingContentScript,
  }), [activeUrl, ensureCollection, startInstagramScrolling, scrollWaitTime]);

  const handleYouTubeAddVideo = async () => {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) return;

      const res = await browser.tabs.sendMessage(tabId, { action: 'ytGetChannelInfo' }) as { name: string; handle: string };
      const channelName = (res?.name || res?.handle || '').trim();

      if (!channelName) {
        setYouTubeErrorMessage("Could not determine the channel for this video.");
        return;
      }

      const collectionName = `${channelName}_videos`;
      ensureCollection('youtube', collectionName, { type: 'video', handle: channelName });
      addBookmarksToCollection('youtube', collectionName, [activeUrl]);

    } catch (err) {
      console.error("Error adding YouTube video:", err);
      setYouTubeErrorMessage("An error occurred while adding the video.");
    }
  };

  const handleYouTubeListVideos = async () => {
    setYouTubeErrorMessage('');

    if (isYouTubePlaylistPage) {
      try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs[0]?.id;
        if (!tabId) return;

        const res = await browser.tabs.sendMessage(tabId, { action: 'ytGetPlaylistInfo' }) as { playlistName: string };
        const playlistName = res?.playlistName.trim();

        if (playlistName) {
          const collectionName = `${playlistName}_playlist`;
          ensureCollection('youtube', collectionName, { type: 'playlist', handle: playlistName });
        }
        startYouTubeScrolling(scrollWaitTime);
      } catch (err) {
        console.error("Error starting YouTube playlist scroll:", err);
      }
      return;
    }

    if (isYouTubeChannelPage) {
      try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs[0]?.id;
        if (!tabId) return;
        
        const res = await browser.tabs.sendMessage(tabId, { action: 'ytGetChannelInfo' }) as { name: string; handle: string };
        const channelName = (res?.name || res?.handle || '').trim();

        if (channelName) {
          const collectionName = `${channelName}_videos`;
          ensureCollection('youtube', collectionName, { type: 'profile', handle: channelName });
          youtubeCurrentCollection.current = collectionName;
        }
        startYouTubeScrolling(scrollWaitTime);
      } catch (err) {
        console.error("Error starting YouTube channel scroll:", err);
      }
      return;
    }

    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (tabId == null) {
        console.warn('Could not get active tab ID.');
        return;
      }

      const response: { videos: { url: string; title: string }[], channelName?: string } =
        await browser.tabs.sendMessage(tabId, { action: 'youtube_scrapeVideos' });

      if (response && response.videos) {
        const { videos, channelName } = response;
        if (videos.length === 0) {
          setYouTubeErrorMessage('No videos found on the page.');
          return;
        }

        setYouTubeErrorMessage('');
        const handle = channelName || 'profile';
        const collectionName = channelName ? `${handle}_videos` : 'youtube_recommendations';
        ensureCollection('youtube', collectionName, { type: 'recommendation', handle });
        addBookmarksToCollection('youtube', collectionName, videos.map(v => v.url));
      } else {
        setYouTubeErrorMessage('Could not retrieve videos from the page.');
      }
    } catch (err) {
      console.error('Error listing YouTube videos:', err);
      setYouTubeErrorMessage('An error occurred while listing videos.');
    }
  };

  const downloadCollection = (platform: string, collectionName: string) => {
    const collectionsByPlatform = collectionStore.collections[platform];
    if (!collectionsByPlatform) return;

    const bookmarks = collectionsByPlatform[collectionName];
    if (!bookmarks || bookmarks.length === 0) {
      alert("No links to download for this collection.");
      return;
    }

    const meta = getCollectionMeta(platform, collectionName) || { type: 'profile', handle: collectionName } as any;
    const filename = `${platform}.${collectionName}.data.${downloadFormat}`;
    let blob: Blob;

    if (downloadFormat === 'json') {
      const jsonData = {
        platform,
        collectionName,
        meta,
        items: bookmarks.map(bm => ({
          url: bm.url,
          mediaType: inferMediaType(platform, bm.url),
        })),
      };
      blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: "application/json;charset=utf-8;" });
    } else {
      const header = ["Platform", "Type", "Handle", "Media", "link"];
      const rows = bookmarks.map(bm => {
        const media = inferMediaType(platform, bm.url);
        return [platform, meta.type, meta.handle, media, bm.url];
      });
      const csvContent = [header, ...rows]
        .map(row => row.map(col => escapeCsv(String(col))).join(","))
        .join("\n");
      blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    }
    
    const url = URL.createObjectURL(blob);
    browser.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    }).catch(err => console.error("Error downloading data:", err));
  };

  const downloadAllCollections = () => {
    const all = collectionStore.collections;
    const platforms = Object.keys(all);
    if (platforms.length === 0) {
      alert("No links to download.");
      return;
    }

    const filename = `all-collections.data.${downloadFormat}`;
    let blob: Blob;

    if (downloadFormat === 'json') {
      const allData = [];
      for (const platform of platforms) {
        const platformCollections = all[platform];
        for (const collectionName of Object.keys(platformCollections)) {
          const bookmarks = platformCollections[collectionName] || [];
          const meta = getCollectionMeta(platform, collectionName) || { type: 'profile', handle: collectionName } as any;
          allData.push({
            platform,
            collectionName,
            meta,
            items: bookmarks.map(bm => ({
              url: bm.url,
              mediaType: inferMediaType(platform, bm.url),
            })),
          });
        }
      }
      if (allData.length === 0) {
        alert("No links to download.");
        return;
      }
      blob = new Blob([JSON.stringify(allData, null, 2)], { type: "application/json;charset=utf-8;" });
    } else {
      const header = ["Platform", "Type", "Handle", "Media", "link"];
      const rows: string[][] = [];
      for (const platform of platforms) {
        const platformCollections = all[platform];
        for (const collectionName of Object.keys(platformCollections)) {
          const bookmarks = platformCollections[collectionName] || [];
          const meta = getCollectionMeta(platform, collectionName) || { type: 'profile', handle: collectionName } as any;
          for (const bm of bookmarks) {
            const media = inferMediaType(platform, bm.url);
            rows.push([platform, String(meta.type), String(meta.handle), media, bm.url]);
          }
        }
      }
      if (rows.length === 0) {
        alert("No links to download.");
        return;
      }
      const csvContent = [header, ...rows]
        .map(row => row.map(col => escapeCsv(String(col))).join(","))
        .join("\n");
      blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    }

    const url = URL.createObjectURL(blob);
    browser.downloads.download({
      url,
      filename,
      saveAs: true
    }).catch(err => console.error("Error downloading combined data:", err));
  };

  return (
    <div className={isDarkMode ? "dark" : ""}>
      <div className="popup-container">
        <div className="top-row">
          {/* Platform indicator */}
          {isInstagramDomain ? (<img src="assets/instagram.webp" alt="Instagram" width={20} height={20} />
          ) : isTikTokDomain ? (<img src="assets/tiktok.webp" alt="TikTok" width={20} height={20} />
          ) : isYouTubeDomain ? (<img src="assets/youtube.webp" alt="YouTube" width={20} height={20} />
          ) : isPinterestDomain ? (<img src="assets/pinterest.png" alt="Pinterest" width={20} height={20} />
          ) : (<Ban size={20} />)}
          <button onClick={toggleTheme} className="theme-toggle-button">
            {isDarkMode ? <Sun /> : <Moon />}
          </button>
          <button onClick={downloadAllCollections} className="theme-toggle-button"><Download /></button>
          <button onClick={() => {
            if (validateBeforeClear) {
              if (confirm("Are you sure you want to clear all saved collections?")) {
                Object.keys(getAllCollections()).forEach(platform => {Object.keys(getAllCollections()[platform]).forEach(collectionName => {deleteCollection(platform, collectionName);});});
              }
            } else {
              Object.keys(getAllCollections()).forEach(platform => {Object.keys(getAllCollections()[platform]).forEach(collectionName => {deleteCollection(platform, collectionName);});});
            }
          }} className="theme-toggle-button" aria-label="Clear all collections">
            <Trash2 size={20} />
          </button>
        <button onClick={() => setIsSettingsOpen(prev => !prev)} className="theme-toggle-button" aria-label="Open settings">
          <Settings size={20} />
        </button>

          {(isInstagramDomain || isTikTokDomain || isYouTubeDomain || isPinterestDomain) && (
            <div className="instagram-controls-section">
              <h4>
                {isInstagramDomain ? igGetInstagramPageTitle(activeUrl)
                  : isTikTokDomain ? iGetTiktokPageTitle(activeUrl, tiktokSectionState)
                  : isYouTubeDomain ? youTubeTitle
                  : pinterestTitle}
              </h4>
              <div className="instagram-buttons-row">
                {scrollStatus === 'idle' && isInstagramDomain && (<button onClick={handleInstagramScrollAndCollect} className="theme-toggle-button" style={{ transform: 'scaleX(-1)' }}><ListTodo size={20} /></button>)}
                {scrollStatus === 'idle' && isTikTokDomain && (<button onClick={handleCollectTiktokFavorites} className="theme-toggle-button" title="Collect favorites"><ListTodo size={20} /></button>)}
                {scrollStatus === 'idle' && isPinterestDomain && (
                  <button onClick={handleCollectPinterestPins} className="theme-toggle-button" title="List pins on this page">
                    <ListTodo size={20} />
                  </button>
                )}
                {scrollStatus === 'idle' && isYouTubeDomain && !isYouTubeVideoPage && !isYouTubeChannelPage && !isYouTubePlaylistPage && (
                  <button onClick={handleYouTubeListVideos} className="theme-toggle-button" title="List videos on this page">
                    <ListTodo size={20} />
                  </button>
                )}
                {scrollStatus === 'idle' && (isYouTubeChannelPage || isYouTubePlaylistPage) && (
                  <button onClick={handleYouTubeListVideos} className="theme-toggle-button" title="List all videos">
                    <ListTodo size={20} />
                  </button>
                )}
                {scrollStatus === 'idle' && isYouTubeVideoPage && (
                  <button onClick={handleYouTubeAddVideo} className="theme-toggle-button" title="Add this video to collections"><Plus size={20} /></button>)}
                {scrollStatus !== 'idle' && (
                  <>
                    <button onClick={stopResumeScrolling} className="theme-toggle-button">{scrollStatus === 'scrolling' ? <Pause size={20} /> : <Play size={20} />}</button>
                    <div className="scroll-timer" style={{ marginBottom: 0 }}>Time until next scroll: {timeRemaining} seconds</div>
                    <button onClick={handleCancelListing} className="cancel-square-button" title="Cancel listing" style={{marginLeft: 'auto'}} aria-label="Cancel listing" />
                  </>
                )}
              </div>
            </div>
          )}

          {isSelecting && (
            <>
              <button onClick={validateSelection} className="btn">Validate</button>
              <button onClick={cancelSelection} className="btn">Cancel</button>
            </>
          )}
        </div>

        {/* Collections or Settings */}
        {isSettingsOpen ? (
          <div className="settings-section">
            <h3>Settings</h3>
            <div className="setting-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label htmlFor="validate-clear" style={{ flex: '0 0 75%', flexShrink: 0 }}>Validate before clearing list</label>
              <div style={{ flex: '1 1 auto', display: 'flex', justifyContent: 'flex-end', paddingRight: '5px' }}>
                <input
                  id="validate-clear"
                  className="setting-checkbox"
                  type="checkbox"
                  checked={validateBeforeClear}
                  onChange={(e) => handleSetValidateBeforeClear(e.target.checked)}
                />
              </div>
            </div>
            <div className="setting-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label htmlFor="scroll-wait" style={{ flex: '0 0 75%', flexShrink: 0 }}>Scroll interval time</label>
              <div style={{ flex: '1 1 auto', display: 'flex', justifyContent: 'flex-end', paddingRight: '5px' }}>
                <input id="scroll-wait" className="setting-input" type="number" value={scrollWaitTime} onChange={(e) => handleSetScrollWaitTime(e.target.value)} style={{ maxWidth: '70px' }} />
              </div>
            </div>
            <div className="setting-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label htmlFor="download-format" style={{ flex: '0 0 75%', flexShrink: 0 }}>Download format</label>
              <div style={{ flex: '1 1 auto', display: 'flex', justifyContent: 'flex-end', paddingRight: '5px' }}>
                <select
                  id="download-format"
                  className="setting-input"
                  value={downloadFormat}
                  onChange={(e) => handleSetDownloadFormat(e.target.value)}
                  style={{ maxWidth: '70px', width: '70px' }}
                >
                  <option value="csv">CSV</option>
                  <option value="json">JSON</option>
                </select>
              </div>
            </div>
          </div>
        ) : (
          <div className="collections-table-section">
            <h3>Saved Collections</h3>
            <table>
              <thead>
                <tr>
                  <th>Platform</th>
                  <th>Type</th>
                  <th>Handle</th>
                  <th>Items</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(getAllCollections()).length === 0 && !youTubeErrorMessage && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', fontSize: '0.85rem', opacity: 0.7 }}>No collections yet</td>
                  </tr>
                )}
                {youTubeErrorMessage && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', fontSize: '0.85rem', color: '#ff6b6b', padding: '1rem' }}>
                      {youTubeErrorMessage}
                    </td>
                  </tr>
                )}
                {Object.entries(getAllCollections()).map(([platform, platformCollections]) => (
                  Object.entries(platformCollections).map(([colName, bookmarks]) => (
                    <tr key={`${platform}-${colName}`}>
                      <td>
                        {platform === 'instagram' && <img src="assets/instagram.webp" alt="Instagram" width={20} height={20} />}
                        {platform === 'tiktok'    && <img src="assets/tiktok.webp" alt="TikTok" width={20} height={20} />}
                        {platform === 'youtube'   && <img src="assets/youtube.webp" alt="YouTube" width={20} height={20} />}
                        {platform === 'pinterest' && <img src="assets/pinterest.png" alt="Pinterest" width={20} height={20} />}
                        {platform === 'other'     && <Ban size={20} />}
                      </td>
                      <td>{getCollectionMeta(platform, colName)?.type || 'profile'}</td>
                      <td>
                        {editingCollection?.platform === platform && editingCollection?.collectionName === colName ? (
                          <input type="text" value={editingValue} onChange={(e) => setEditingValue(e.target.value)} onKeyDown={handleEditKeyPress} onBlur={saveCollectionEdit} className="collection-edit-input" autoFocus style={{width: '100%', fontSize: '0.85rem'}} />
                        ) : (
                          <span
                            onClick={() => startEditingCollection(platform, colName)}
                            style={{cursor: 'pointer', userSelect: 'none', padding: '0.25rem', borderRadius: '4px', transition: 'background-color 0.2s'}}
                            title="Click to edit collection name"
                            onMouseEnter={(e) => {e.currentTarget.style.backgroundColor = isDarkMode ? '#4a5568' : '#f0f0f0'}}
                            onMouseLeave={(e) => {e.currentTarget.style.backgroundColor = 'transparent'}}>
                            {getCollectionMeta(platform, colName)?.handle || colName}
                          </span>
                        )}
                      </td>
                      <td>{bookmarks.length}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', justifyContent: 'center' }}>
                          <button onClick={() => deleteCollection(platform, colName)} className="theme-toggle-button" aria-label="Delete collection"><Trash2 size={18} /></button>
                          <button onClick={() => downloadCollection(platform, colName)} className="theme-toggle-button" aria-label="Download data CSV"><Download size={18} /></button>
                        </div>
                      </td>
                    </tr>
                  ))
                ))}
              </tbody>
            </table>
          </div>
        )}

      </div>
    </div>
  );
};

export default Popup;
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <Popup />
    </React.StrictMode>
  );
}
