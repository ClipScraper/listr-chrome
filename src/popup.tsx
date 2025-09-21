import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { Sun, Moon, Download, Ban, Save, ListTodo, Play, Pause } from 'lucide-react';
// import { LuListEnd } from 'react-icons/lu';
import browser from 'webextension-polyfill';
import { useActiveTab } from './hooks/useActiveTab';
import { useScrolling } from './hooks/useScrolling';
import { useSelectionMode } from './hooks/useSelectionMode';
import { useCollections, Bookmark, CollectionStore } from './hooks/useCollections';
import './styles/popup.css';

const tiktokVideoRegex = /^https:\/\/www\.tiktok\.com\/[^/]+\/[^/]+\/\d+/;

const Popup: React.FC = () => {
  const { activeUrl } = useActiveTab();
  const { scrollStatus, timeRemaining, startScrolling, stopResumeScrolling, startInstagramScrolling } = useScrolling();
  const { collectionStore, addBookmarksToCollection, deleteCollection, getAllCollections } = useCollections();
  const { isSelecting, startSelectionMode, validateSelection, cancelSelection } = useSelectionMode((urls) => addBookmarksToCollection('tiktok', 'selected_tiktok_links', urls));

  const [isDarkMode, setIsDarkMode] = React.useState(false);
  const toggleTheme = () => setIsDarkMode(prev => !prev);

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

  const onInstagramScrollComplete = () => {
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
  };

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

  // Open endpoint tab, then forward bookmarks to it via content script
  const handleDownloadClick = () => {
    browser.tabs.create({ url: ENDPOINT })
      .then(tab => {
        setTimeout(() => {
          if (tab.id != null) {
            browser.tabs.sendMessage(tab.id, { action: 'extensionData', payload: getAllCollections() })
              .catch(err => console.error("Error sending bookmarks:", err));
          }
        }, 2000);
      })
      .catch(err => console.error("Error opening endpoint:", err));
  };

  const handleInstagramScrollAndCollect = () => {
    if (isInstagramDomain && scrollStatus === 'idle') {
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
          <button onClick={handleDownloadClick} className="theme-toggle-button">
            <Download />
          </button>
          {/* Instagram Specific Controls */}
          {isInstagramDomain && (
            <div className="instagram-controls-section">
              <h4>{getInstagramPageTitle(activeUrl)}</h4>
              <div className="instagram-buttons-row">
                <button
                  onClick={scrollStatus === 'idle' ? handleInstagramScrollAndCollect : stopResumeScrolling}
                  className="theme-toggle-button"
                >
                  {scrollStatus === 'scrolling' ? <Pause size={20} /> : <Play size={20} />}
                </button>
                {scrollStatus === 'idle' && (
                  <button onClick={handleInstagramScrollAndCollect} className="theme-toggle-button" style={{ transform: 'scaleX(-1)' }}>
                    <ListTodo size={20} />
                  </button>
                )}
                <button onClick={() => downloadCollectionAsCsv('instagram', extractInstagramCollectionName(activeUrl))} className="theme-toggle-button">
                  <Save size={20} />
                </button>
              </div>
            </div>
          )}
          <button onClick={() => {
            if (confirm("Are you sure you want to clear all saved collections?")) {
              Object.keys(getAllCollections()).forEach(platform => {
                Object.keys(getAllCollections()[platform]).forEach(collectionName => {
                  deleteCollection(platform, collectionName);
                });
              });
            }
          }} className="btn">
            Clear All Collections
          </button>
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
        {Object.keys(getAllCollections()).length > 0 && (
          <div className="collections-table-section">
            <h3>Saved Collections</h3>
            <table>
              <thead>
                <tr>
                  <th>Platform</th>
                  <th>Collection Name</th>
                  <th>Items</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(getAllCollections()).map(([platform, platformCollections]) => (
                  Object.entries(platformCollections).map(([colName, bookmarks]) => (
                    <tr key={`${platform}-${colName}`}>
                      <td>
                        {platform === 'instagram' && <img src="assets/instagram.webp" alt="Instagram" width={20} height={20} />}
                        {platform === 'tiktok' && <img src="assets/tiktok.webp" alt="TikTok" width={20} height={20} />}
                        {platform === 'other' && <Ban size={20} />}
                      </td>
                      <td>{colName}</td>
                      <td>{bookmarks.length}</td>
                      <td>
                        <button onClick={() => deleteCollection(platform, colName)} className="delete-button">
                          X
                        </button>
                        <button onClick={() => downloadCollectionAsCsv(platform, colName)} className="theme-toggle-button">
                          <Save size={20} />
                        </button>
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

ReactDOM.render(<Popup />, document.getElementById('root'));


