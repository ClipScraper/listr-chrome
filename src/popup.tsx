import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { Sun, Moon, Download, Ban, ListTodo, Play, Pause, Trash2, Plus } from 'lucide-react';
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
  const { collectionStore, addBookmarksToCollection, deleteCollection, getAllCollections, ensureCollection, getCollectionMeta } = useCollections();
  const { isSelecting, startSelectionMode, validateSelection, cancelSelection } = useSelectionMode((urls) => addBookmarksToCollection('tiktok', 'selected_tiktok_links', urls));

  const [isDarkMode, setIsDarkMode] = React.useState(false);
  const toggleTheme = () => setIsDarkMode(prev => !prev);

  // TikTok section detection
  const [tiktokSectionState, setTiktokSectionState] = React.useState<{ username: string; section: string } | null>(null);
  const tiktokActiveCollectionRef = React.useRef<{ name: string; type: 'bookmarks' | 'favorites' | 'liked' | 'reposts' | 'profile'; handle: string } | null>(null);
  const tiktokPollIntervalRef = React.useRef<number | null>(null);

  const isTikTokDomain = activeUrl.startsWith("https://www.tiktok.com");
  const isInstagramDomain = activeUrl.startsWith("https://www.instagram.com");
  const isYouTubeDomain = activeUrl.startsWith("https://www.youtube.com"); // used for icon and header selection
  const isYouTubeVideoPage = isYouTubeDomain && activeUrl.includes('/watch?v=');
  const isYouTubePlaylistPage = isYouTubeDomain && activeUrl.includes('/playlist?list=');
  const isYouTubeChannelPage = isYouTubeDomain && (
    activeUrl.includes('/videos') || activeUrl.includes('/shorts') || activeUrl.includes('/streams')
  );

  const [youTubeTitle, setYouTubeTitle] = React.useState<string>(() => getYouTubePageTitle(activeUrl));

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

  // --- NEW: listen for pushes from the YouTube content script
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
    // support all youtube TLDs (youtube.com, youtube.co.uk, etc.)
    if (!/^https:\/\/www\.youtube\./.test(activeUrl)) return;

    (async () => {
      try {
        console.log("[YT POPUP] effect start for", activeUrl);
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs[0]?.id;
        if (tabId == null) {
          setYouTubeTitle(getYouTubePageTitle(activeUrl));
          return;
        }
        console.log("[YT POPUP] sending ytGetChannelInfo → tab", tabId);
        const res = await browser.tabs.sendMessage(tabId, { action: 'ytGetChannelInfo' })
          .catch(err => {
            console.warn("[YT POPUP] sendMessage error:", err);
            return null;
          }) as any;

        console.log("[YT POPUP] response:", res);

        const name = (res?.name || '').trim();
        const handle = (res?.handle || '').trim();

        if (name) {
          setYouTubeTitle(`YouTube Channel: ${name}`);
        } else if (handle) {
          setYouTubeTitle(`YouTube Channel: ${handle}`);
        } else {
          setYouTubeTitle(getYouTubePageTitle(activeUrl));
        }
      } catch (e) {
        console.warn("[YT POPUP] effect error:", e);
        setYouTubeTitle(getYouTubePageTitle(activeUrl));
      }
    })();
  }, [activeUrl]);

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
              const tabs = await browser.tabs.query({ active: true, currentWindow: true });
              const tabId = tabs[0]?.id;
              if (!tabId) return;

              if (isYouTubePlaylistPage) {
                const res = await browser.tabs.sendMessage(tabId, { action: 'ytGetPlaylistInfo' }) as { playlistName: string };
                const playlistName = res?.playlistName.trim();
                if (playlistName) {
                  const collectionName = `${playlistName}_playlist`;
                  addBookmarksToCollection('youtube', collectionName, links);
                }
              } else {
                const res = await browser.tabs.sendMessage(tabId, { action: 'ytGetChannelInfo' }) as { name: string; handle: string };
                const channelName = (res?.name || res?.handle || '').trim();
                if (channelName) {
                  const collectionName = `${channelName}_videos`;
                  addBookmarksToCollection('youtube', collectionName, links);
                }
              }
            } catch {}
          })();
        }
      }
    };
    browser.runtime.onMessage.addListener(handler);
    return () => browser.runtime.onMessage.removeListener(handler);
  }, [activeUrl]);

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
      startScrolling,
    });
  }, [activeUrl, ensureCollection, addBookmarksToCollection, pingContentScript, scrollStatus, startScrolling]);

  const handleCancelListing = () => {
    cancelScrolling();
    tiktokActiveCollectionRef.current = null;
    if (tiktokPollIntervalRef.current) {
      window.clearInterval(tiktokPollIntervalRef.current);
      tiktokPollIntervalRef.current = null;
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
    return 'unknown';
  };

  const handleInstagramScrollAndCollect = React.useCallback(() => iHandleInstagramScrollAndCollect({
    activeUrl,
    ensureCollection,
    startInstagramScrolling,
    pingContentScript,
  }), [activeUrl, ensureCollection, startInstagramScrolling]);

  const handleYouTubeAddVideo = async () => {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) return;

      const res = await browser.tabs.sendMessage(tabId, { action: 'ytGetChannelInfo' }) as { name: string; handle: string };
      const channelName = (res?.name || res?.handle || '').trim();

      if (!channelName) {
        alert("Could not determine the channel for this video.");
        return;
      }

      const collectionName = `${channelName}_videos`;
      ensureCollection('youtube', collectionName, { type: 'video', handle: channelName });
      addBookmarksToCollection('youtube', collectionName, [activeUrl]);

    } catch (err) {
      console.error("Error adding YouTube video:", err);
      alert("An error occurred while adding the video.");
    }
  };

  const handleYouTubeListVideos = async () => {
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
        startYouTubeScrolling();
      } catch (err) {
        console.error("Error starting YouTube playlist scroll:", err);
      }
      return;
    }

    if (isYouTubeChannelPage) {
      // Start scrolling and collecting
      try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs[0]?.id;
        if (!tabId) return;
        
        const res = await browser.tabs.sendMessage(tabId, { action: 'ytGetChannelInfo' }) as { name: string; handle: string };
        const channelName = (res?.name || res?.handle || '').trim();

        if (channelName) {
          const collectionName = `${channelName}_videos`;
          ensureCollection('youtube', collectionName, { type: 'profile', handle: channelName });
          // Pass collection name to scrolling hook or another mechanism
        }
        
        startYouTubeScrolling();
        
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
          alert('No videos found on the page.');
          return;
        }

        const handle = channelName || 'profile';
        const collectionName = channelName ? `${handle}_videos` : 'youtube_recommendations';

        ensureCollection('youtube', collectionName, { type: 'recommendation', handle });
        addBookmarksToCollection('youtube', collectionName, videos.map(v => v.url));
      } else {
        alert('Could not retrieve videos from the page.');
      }
    } catch (err) {
      console.error('Error listing YouTube videos:', err);
      alert('An error occurred while listing videos.');
    }
  };

  const downloadCollectionAsDetailedCsv = (platform: string, collectionName: string) => {
    const collectionsByPlatform = collectionStore.collections[platform];
    if (!collectionsByPlatform) return;

    const bookmarks = collectionsByPlatform[collectionName];
    if (!bookmarks || bookmarks.length === 0) {
      alert("No links to download for this collection.");
      return;
    }

    const meta = getCollectionMeta(platform, collectionName) || { type: 'profile', handle: collectionName } as any;

    const header = ["Platform", "Type", "Handle", "Media", "link"];
    const rows = bookmarks.map(bm => {
      const media = inferMediaType(platform, bm.url);
      return [platform, meta.type, meta.handle, media, bm.url];
    });

    const csvContent = [header, ...rows]
      .map(row => row.map(col => escapeCsv(String(col))).join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const filename = `${platform}.${collectionName}.data.csv`;

    browser.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    }).catch(err => console.error("Error downloading detailed CSV:", err));
  };

  const downloadAllCollectionsAsDetailedCsv = () => {
    const all = collectionStore.collections;
    const platforms = Object.keys(all);
    if (platforms.length === 0) {
      alert("No links to download.");
      return;
    }

    const header = ["Platform", "Type", "Handle", "Media", "link"];
    const rows: string[][] = [];
    for (const platform of platforms) {
      const platformCollections = all[platform];
      for (const collectionName of Object.keys(platformCollections)) {
        const bookmarks = platformCollections[collectionName] || [];
        const meta = getCollectionMeta(platform, collectionName) || { type: 'profile', handle: collectionName } as any;
        for (const bm of bookmarks) {
          const media = inferMediaType(platform, bm.url);
          rows.push([
            platform,
            String(meta.type),
            String(meta.handle),
            media,
            bm.url,
          ]);
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

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const filename = `all-collections.data.csv`;
    browser.downloads.download({
      url,
      filename,
      saveAs: true
    }).catch(err => console.error("Error downloading combined CSV:", err));
  };

  return (
    <div className={isDarkMode ? "dark" : ""}>
      <div className="popup-container">
        <div className="top-row">
          {/* Platform indicator */}
          {isInstagramDomain ? (<img src="assets/instagram.webp" alt="Instagram" width={20} height={20} />
          ) : isTikTokDomain ? (<img src="assets/tiktok.webp" alt="TikTok" width={20} height={20} />
          ) : isYouTubeDomain ? (<img src="assets/youtube.webp" alt="YouTube" width={20} height={20} />
          ) : (<Ban size={20} />)}
          <button onClick={toggleTheme} className="theme-toggle-button">
            {isDarkMode ? <Sun /> : <Moon />}
          </button>
          <button onClick={downloadAllCollectionsAsDetailedCsv} className="theme-toggle-button"><Download /></button>
          <button onClick={() => {
            if (confirm("Are you sure you want to clear all saved collections?")) {
              Object.keys(getAllCollections()).forEach(platform => {Object.keys(getAllCollections()[platform]).forEach(collectionName => {deleteCollection(platform, collectionName);});});
            }
          }} className="theme-toggle-button" aria-label="Clear all collections">
            <Trash2 size={20} />
          </button>

          {(isInstagramDomain || isTikTokDomain || isYouTubeDomain) && (
            <div className="instagram-controls-section">
              <h4>{isInstagramDomain ? igGetInstagramPageTitle(activeUrl) : (isTikTokDomain ? iGetTiktokPageTitle(activeUrl, tiktokSectionState) : youTubeTitle)}</h4>
              <div className="instagram-buttons-row">
                {scrollStatus === 'idle' && isInstagramDomain && (<button onClick={handleInstagramScrollAndCollect} className="theme-toggle-button" style={{ transform: 'scaleX(-1)' }}><ListTodo size={20} /></button>)}
                {scrollStatus === 'idle' && isTikTokDomain && (<button onClick={handleCollectTiktokFavorites} className="theme-toggle-button" title="Collect favorites"><ListTodo size={20} /></button>)}
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

        {/* Collections Display Table */}
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
              {Object.keys(getAllCollections()).length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', fontSize: '0.85rem', opacity: 0.7 }}>No collections yet</td>
                </tr>
              )}
              {Object.entries(getAllCollections()).map(([platform, platformCollections]) => (
                Object.entries(platformCollections).map(([colName, bookmarks]) => (
                  <tr key={`${platform}-${colName}`}>
                    <td>
                      {platform === 'instagram' && <img src="assets/instagram.webp" alt="Instagram" width={20} height={20} />}
                      {platform === 'tiktok' && <img src="assets/tiktok.webp" alt="TikTok" width={20} height={20} />}
                      {platform === 'youtube' && <img src="assets/youtube.webp" alt="YouTube" width={20} height={20} />}
                      {platform === 'other' && <Ban size={20} />}
                    </td>
                    <td>{getCollectionMeta(platform, colName)?.type || 'profile'}</td>
                    <td>{getCollectionMeta(platform, colName)?.handle || colName}</td>
                    <td>{bookmarks.length}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', justifyContent: 'center' }}>
                        <button onClick={() => deleteCollection(platform, colName)} className="theme-toggle-button" aria-label="Delete collection"><Trash2 size={18} /></button>
                        <button onClick={() => downloadCollectionAsDetailedCsv(platform, colName)} className="theme-toggle-button" aria-label="Download data CSV"><Download size={18} /></button>
                      </div>
                    </td>
                  </tr>
                ))
              ))}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
};

ReactDOM.render(<Popup />, document.getElementById('root'));
