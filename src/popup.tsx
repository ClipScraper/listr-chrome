import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { Sun, Moon, Download, Ban } from 'lucide-react';
import browser from 'webextension-polyfill';
import { useActiveTab } from './hooks/useActiveTab';
import { useBookmarks } from './hooks/useBookmarks';
import { useScrolling } from './hooks/useScrolling';
import { useSelectionMode } from './hooks/useSelectionMode';
import './styles/popup.css';

const tiktokVideoRegex = /^https:\/\/www\.tiktok\.com\/[^/]+\/[^/]+\/\d+/;

const Popup: React.FC = () => {
  const { activeUrl } = useActiveTab();
  const { bookmarks, addBookmark, addMultipleBookmarks, removeBookmark, clearBookmarks } = useBookmarks();
  const { scrollStatus, timeRemaining, startScrolling, stopResumeScrolling } = useScrolling();
  const { isSelecting, startSelectionMode, validateSelection, cancelSelection } = useSelectionMode(addMultipleBookmarks);

  const [isDarkMode, setIsDarkMode] = React.useState(false);
  const toggleTheme = () => setIsDarkMode(prev => !prev);

  const isTikTokDomain = activeUrl.startsWith("https://www.tiktok.com");
  const isInstagramDomain = activeUrl.startsWith("https://www.instagram.com");
  const isVideoPage = tiktokVideoRegex.test(activeUrl);

  const handleBookmarkClick = () => {
    if (!isVideoPage) {
      alert("Not a valid TikTok video page.");
      return;
    }
    addBookmark(activeUrl);
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
          addMultipleBookmarks(res.links);
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
            browser.tabs.sendMessage(tab.id, { action: 'extensionData', payload: bookmarks })
              .catch(err => console.error("Error sending bookmarks:", err));
          }
        }, 2000);
      })
      .catch(err => console.error("Error opening endpoint:", err));
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
          <button onClick={clearBookmarks} className="btn">
            Clear selection
          </button>
          {isTikTokDomain && !isVideoPage && !isSelecting && scrollStatus === 'idle' && (
            <button onClick={startScrolling} className="btn">
              Start Scrolling
            </button>
          )}
          {isTikTokDomain && !isVideoPage && !isSelecting && scrollStatus !== 'idle' && (
            <button onClick={stopResumeScrolling} className="btn">
              {scrollStatus === 'scrolling' ? 'Stop' : 'Resume'}
            </button>
          )}
          {isTikTokDomain && isVideoPage && !isSelecting && (
            <button onClick={handleBookmarkClick} className="btn">
              Bookmark
            </button>
          )}
          {isTikTokDomain && !isVideoPage && !isSelecting && (
            <>
              <button onClick={handleBookmarkAll} className="btn">
                All
              </button>
              <button onClick={startSelectionMode} className="btn">
                Select
              </button>
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

        <div className="bookmark-list">
          <ul>
            {bookmarks.map((bm, idx) => {
              const shortUrl = bm.replace(/^https?:\/\/(www\.)?tiktok\.com\//, "");
              return (
                <li key={idx}>
                  <button onClick={() => removeBookmark(bm)} className="delete-button">
                    X
                  </button>
                  <span>{shortUrl}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
};

ReactDOM.render(<Popup />, document.getElementById('root'));


