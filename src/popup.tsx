import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { Sun, Moon, Download, Ban, Save, ListTodo, Play, Pause, Trash2 } from 'lucide-react';
// import { LuListEnd } from 'react-icons/lu';
import browser from 'webextension-polyfill';
import { useActiveTab } from './hooks/useActiveTab';
import { useScrolling } from './hooks/useScrolling';
import { useSelectionMode } from './hooks/useSelectionMode';
import { useCollections, Bookmark, CollectionStore } from './hooks/useCollections';
import './styles/popup.css';

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

const tiktokVideoRegex = /^https:\/\/www\.tiktok\.com\/[^/]+\/[^/]+\/\d+/;

const Popup: React.FC = () => {
  const { activeUrl } = useActiveTab();
  const { scrollStatus, timeRemaining, startScrolling, stopResumeScrolling, startInstagramScrolling } = useScrolling(onInstagramScrollComplete);
  const { collectionStore, addBookmarksToCollection, deleteCollection, getAllCollections, ensureCollection, getCollectionMeta } = useCollections();
  const { isSelecting, startSelectionMode, validateSelection, cancelSelection } = useSelectionMode((urls) => addBookmarksToCollection('tiktok', 'selected_tiktok_links', urls));

  const [isDarkMode, setIsDarkMode] = React.useState(false);
  const toggleTheme = () => setIsDarkMode(prev => !prev);

  React.useEffect(() => {
    const handler = (message: any) => {
      if (message.type === 'instaNewLinks') {
        // Determine active Instagram collection name and append incrementally
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
    };
    browser.runtime.onMessage.addListener(handler);
    return () => browser.runtime.onMessage.removeListener(handler);
  }, [activeUrl]);

  const isTikTokDomain = activeUrl.startsWith("https://www.tiktok.com");
  const isInstagramDomain = activeUrl.startsWith("https://www.instagram.com");
  const isVideoPage = tiktokVideoRegex.test(activeUrl);

  const extractInstagramCollectionName = (url: string) => {
    const match = url.match(/https:\/\/www\.instagram\.com\/([^/]+)\/saved\/([^/]+)\//);
    if (match && match[2]) {
      return match[2];
    }
    return 'my_collection';
  };

  const getInstagramPageTitle = (url: string) => {
    const savedPageMatch = url.match(/https:\/\/www\.instagram\.com\/([^/]+)\/saved\/([^/]+)\//);
    if (savedPageMatch && savedPageMatch[2]) {
      return `Bookmarks: ${savedPageMatch[2]}`;
    }
    const userPageMatch = url.match(/https:\/\/www\.instagram\.com\/([^/]+)\//);
    if (userPageMatch && userPageMatch[1]) {
      return `Page: ${userPageMatch[1]}`;
    }
    return 'Instagram Page';
  };

  const getInstagramTypeAndHandle = (url: string) => {
    const savedMatch = url.match(/https:\/\/www\.instagram\.com\/([^/]+)\/saved\/([^/]+)\//);
    if (savedMatch && savedMatch[2]) {
      return { type: 'bookmarks' as const, handle: savedMatch[2] };
    }
    const userMatch = url.match(/https:\/\/www\.instagram\.com\/([^/]+)\//);
    if (userMatch && userMatch[1]) {
      return { type: 'profile' as const, handle: userMatch[1] };
    }
    return { type: 'profile' as const, handle: 'unknown' };
  };

  function onInstagramScrollComplete() {
    if (!isInstagramDomain) return;
    browser.tabs.query({ active: true, currentWindow: true })
      .then(tabs => {
        const tabId = tabs[0]?.id;
        if (tabId != null) {
          return browser.tabs.sendMessage(tabId, { action: "collectInstagramPostLinks" });
        }
      })
      .then((response: any) => {
        if (!response || !response.links) {
          console.log("No links received from content script or response is invalid.", response);
          return;
        }
        console.log("Received Instagram links from content script:", response.links);

        let collectionName = extractInstagramCollectionName(activeUrl);
        if (activeUrl.includes('/saved/all-posts/')) {
          collectionName = 'all-posts';
        } else {
          const promptName = prompt("Enter a name for this collection:", collectionName);
          if (promptName) {
            collectionName = promptName;
          } else {
            return; // User cancelled prompt
          }
        }

        addBookmarksToCollection('instagram', collectionName, response.links);
      })
      .catch(err => console.error("Error collecting Instagram links:", err));
  }

  const handleBookmarkClick = () => {
    if (!isVideoPage) {
      alert("Not a valid TikTok video page.");
      return;
    }
    addBookmarksToCollection('tiktok', 'single_bookmarks', [activeUrl]);
  };

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
    if (platform === 'tiktok') return 'video';
    return 'unknown';
  };

  const handleInstagramScrollAndCollect = async () => {
    if (isInstagramDomain && scrollStatus === 'idle') {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (tabId == null) {
        console.error("No active tab found.");
        return;
      }

      // Ping the content script before starting to scroll
      const isContentScriptReady = await pingContentScript(tabId);
      if (!isContentScriptReady) {
        console.error("Content script is not ready. Cannot start scrolling.");
        alert("The content script is not active on this page. Please refresh the page and try again.");
        return;
      }

      // Ensure an empty collection is visible immediately
      let collectionName = extractInstagramCollectionName(activeUrl);
      if (activeUrl.includes('/saved/all-posts/')) {
        collectionName = 'all-posts';
      }
      const meta = getInstagramTypeAndHandle(activeUrl);
      ensureCollection('instagram', collectionName, { type: meta.type, handle: meta.handle });

      // Add a small delay to ensure content script is ready
      setTimeout(() => {
        startInstagramScrolling();
      }, 500);
    }
  };

  const downloadCollectionAsCsv = (platform: string, collectionName: string) => {
    const collectionsByPlatform = collectionStore.collections[platform];
    if (!collectionsByPlatform) return;

    const collectionLinks = collectionsByPlatform[collectionName];
    if (!collectionLinks || collectionLinks.length === 0) {
      alert("No links to download for this collection.");
      return;
    }

    const csvContent = "Link\n" + collectionLinks.map(bm => bm.url).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const filename = `${platform}.${collectionName}.csv`;

    browser.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    }).catch(err => console.error("Error downloading CSV:", err));
  };

  // New: download a detailed CSV with columns: Platform, Type, Handle, Media, link
  const downloadCollectionAsDetailedCsv = (platform: string, collectionName: string) => {
    const collectionsByPlatform = collectionStore.collections[platform];
    if (!collectionsByPlatform) return;

    const bookmarks = collectionsByPlatform[collectionName];
    if (!bookmarks || bookmarks.length === 0) {
      alert("No links to download for this collection.");
      return;
    }

    const meta = getCollectionMeta(platform, collectionName) || { type: 'profile', handle: collectionName } as any;

    const header = ["Platform", "Type", "Handle", "Media", "link"]; // Type = collection kind; Media = video/pictures
    const rows = bookmarks.map(bm => {
      const media = inferMediaType(platform, bm.url);
      return [
        platform,
        meta.type,
        meta.handle,
        media,
        bm.url,
      ];
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

  // New: download one CSV aggregating ALL collections across platforms
  const downloadAllCollectionsAsDetailedCsv = () => {
    const all = collectionStore.collections;
    const platforms = Object.keys(all);
    if (platforms.length === 0) {
      alert("No links to download.");
      return;
    }

    const header = ["Platform", "Type", "Handle", "Media", "link"]; // Type = collection kind; Media = video/pictures
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
          {isInstagramDomain ? (
            <img src="assets/instagram.webp" alt="Instagram" width={20} height={20} />
          ) : isTikTokDomain ? (
            <img src="assets/tiktok.webp" alt="TikTok" width={20} height={20} />
          ) : (
            <Ban size={20} />
          )}
          <button onClick={toggleTheme} className="theme-toggle-button">
            {isDarkMode ? <Sun /> : <Moon />}
          </button>
          <button onClick={downloadAllCollectionsAsDetailedCsv} className="theme-toggle-button">
            <Download />
          </button>
          <button onClick={() => {
            if (confirm("Are you sure you want to clear all saved collections?")) {
              Object.keys(getAllCollections()).forEach(platform => {
                Object.keys(getAllCollections()[platform]).forEach(collectionName => {
                  deleteCollection(platform, collectionName);
                });
              });
            }
          }} className="theme-toggle-button" aria-label="Clear all collections">
            <Trash2 size={20} />
          </button>
          {/* Instagram Specific Controls */}
          {isInstagramDomain && (
            <div className="instagram-controls-section">
              <h4>{getInstagramPageTitle(activeUrl)}</h4>
              <div className="instagram-buttons-row">
                {scrollStatus === 'idle' && (
                  <button onClick={handleInstagramScrollAndCollect} className="theme-toggle-button" style={{ transform: 'scaleX(-1)' }}>
                    <ListTodo size={20} />
                  </button>
                )}
                <button
                  onClick={scrollStatus === 'idle' ? handleInstagramScrollAndCollect : stopResumeScrolling}
                  className="theme-toggle-button"
                >
                  {scrollStatus === 'scrolling' ? <Pause size={20} /> : <Play size={20} />}
                </button>
              </div>
            </div>
          )}
          {isTikTokDomain && (
            <>
              {(!isVideoPage && !isSelecting && scrollStatus === 'idle') && (
                <button onClick={startScrolling} className="btn">
                  Start Scrolling
                </button>
              )}
              {(!isVideoPage && !isSelecting && scrollStatus !== 'idle') && (
                <button onClick={stopResumeScrolling} className="btn">
                  {scrollStatus === 'scrolling' ? 'Stop' : 'Resume'}
                </button>
              )}
              {isVideoPage && !isSelecting && (
                <button onClick={handleBookmarkClick} className="btn">
                  Bookmark
                </button>
              )}
              {!isVideoPage && !isSelecting && (
                <>
                  <button onClick={handleBookmarkAll} className="btn">
                    All
                  </button>
                  <button onClick={startSelectionMode} className="btn">
                    Select
                  </button>
                </>
              )}
            </>
          )}
          {isSelecting && (
            <>
              <button onClick={validateSelection} className="btn">
                Validate
              </button>
              <button onClick={cancelSelection} className="btn">
                Cancel
              </button>
            </>
          )}
        </div>

        {scrollStatus !== 'idle' && (
          <div className="scroll-timer">
            Time until next scroll: {timeRemaining} seconds
          </div>
        )}

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
                      {platform === 'other' && <Ban size={20} />}
                    </td>
                    <td>{getCollectionMeta(platform, colName)?.type || 'profile'}</td>
                    <td>{getCollectionMeta(platform, colName)?.handle || colName}</td>
                    <td>{bookmarks.length}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                        <button onClick={() => deleteCollection(platform, colName)} className="theme-toggle-button" aria-label="Delete collection">
                          <Trash2 size={18} />
                        </button>
                        <button onClick={() => downloadCollectionAsCsv(platform, colName)} className="theme-toggle-button" aria-label="Save collection">
                          <Save size={20} />
                        </button>
                        <button onClick={() => downloadCollectionAsDetailedCsv(platform, colName)} className="theme-toggle-button" aria-label="Download data CSV">
                          <Download size={18} />
                        </button>
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


