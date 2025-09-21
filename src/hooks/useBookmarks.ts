import { useEffect, useState } from 'react';
import browser from 'webextension-polyfill';

export function useBookmarks() {
  const [bookmarks, setBookmarks] = useState<string[]>([]);

  useEffect(() => {
    // Load existing bookmarks
    browser.storage.local.get("bookmarks")
      .then(data => {
        if (data.bookmarks && Array.isArray(data.bookmarks)) {
          setBookmarks(data.bookmarks);
        }
      })
      .catch(err => console.error("Error loading bookmarks:", err));
  }, []);

  function addBookmark(newUrl: string) {
    if (bookmarks.includes(newUrl)) return; // already bookmarked
    const updated = [...bookmarks, newUrl];
    browser.storage.local.set({ bookmarks: updated })
      .then(() => setBookmarks(updated))
      .catch(err => console.error("Error saving bookmark:", err));
  }

  function addMultipleBookmarks(urls: string[]) {
    const newBookmarks: string[] = [];
    urls.forEach(url => {
      if (!bookmarks.includes(url) && !newBookmarks.includes(url)) {
        newBookmarks.push(url);
      }
    });
    const updated = [...bookmarks, ...newBookmarks];
    browser.storage.local.set({ bookmarks: updated })
      .then(() => setBookmarks(updated))
      .catch(err => console.error("Error saving bookmarks:", err));
  }

  function removeBookmark(url: string) {
    const updated = bookmarks.filter(item => item !== url);
    browser.storage.local.set({ bookmarks: updated })
      .then(() => setBookmarks(updated))
      .catch(err => console.error("Error removing bookmark:", err));
  }

  function clearBookmarks() {
    browser.storage.local.set({ bookmarks: [] })
      .then(() => setBookmarks([]))
      .catch(err => console.error("Error clearing bookmarks:", err));
  }

  return { bookmarks, addBookmark, addMultipleBookmarks, removeBookmark, clearBookmarks };
}


