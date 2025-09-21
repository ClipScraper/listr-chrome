import { useState } from 'react';
import browser from 'webextension-polyfill';

export function useSelectionMode(addMultipleBookmarks: (urls: string[]) => void) {
  const [isSelecting, setIsSelecting] = useState(false);

  function startSelectionMode() {
    browser.tabs.query({ active: true, currentWindow: true })
      .then(tabs => {
        const tabId = tabs[0]?.id;
        if (tabId != null) {
          return browser.tabs.sendMessage(tabId, { action: "startSelectionMode" });
        }
      })
      .then(() => setIsSelecting(true))
      .catch(err => console.error("Error starting selection mode:", err));
  }

  function validateSelection() {
    browser.tabs.query({ active: true, currentWindow: true })
      .then(tabs => {
        const tabId = tabs[0]?.id;
        if (tabId != null) {
          return browser.tabs.sendMessage(tabId, { action: "validateSelection" });
        }
      })
      .then(response => {
        if (!response) return;
        const res = response as { status: string; links: string[] };
        if (!res.links) return;
        addMultipleBookmarks(res.links);
      })
      .catch(err => console.error("Error validating selection:", err))
      .finally(() => setIsSelecting(false));
  }

  function cancelSelection() {
    browser.tabs.query({ active: true, currentWindow: true })
      .then(tabs => {
        const tabId = tabs[0]?.id;
        if (tabId != null) {
          return browser.tabs.sendMessage(tabId, { action: "cancelSelection" });
        }
      })
      .then(() => setIsSelecting(false))
      .catch(err => console.error("Error canceling selection:", err));
  }

  return { isSelecting, startSelectionMode, validateSelection, cancelSelection };
}


