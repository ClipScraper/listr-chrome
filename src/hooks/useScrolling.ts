import { useEffect, useState } from 'react';
import browser from 'webextension-polyfill';

export type ScrollStatus = 'idle' | 'scrolling' | 'paused';

export function useScrolling(onScrollComplete?: () => void) {
  const [scrollStatus, setScrollStatus] = useState<ScrollStatus>('idle');
  const [timeRemaining, setTimeRemaining] = useState(0);

  useEffect(() => {
    // Listen for scroll updates from content script
    const handleMessage = (message: any) => {
      if (message.type === 'scrollTimeUpdate') {
        setTimeRemaining(message.timeRemaining);
      }
      else if (message.type === 'scrollComplete') {
        setScrollStatus('idle');
        if (onScrollComplete) {
          onScrollComplete();
        }
      }
    };
    browser.runtime.onMessage.addListener(handleMessage);

    return () => {
      browser.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  function startScrolling() {
    browser.tabs.query({ active: true, currentWindow: true })
      .then(tabs => {
        const tabId = tabs[0]?.id;
        if (tabId != null) {
          return browser.tabs.sendMessage(tabId, { action: "startScrolling" });
        }
      })
      .then(() => setScrollStatus('scrolling'))
      .catch(err => console.error("Error starting scroll:", err));
  }

  function startInstagramScrolling() {
    browser.tabs.query({ active: true, currentWindow: true })
      .then(tabs => {
        const tabId = tabs[0]?.id;
        if (tabId != null) {
          return browser.tabs.sendMessage(tabId, { action: "startInstagramScrolling" });
        }
      })
      .then(() => setScrollStatus('scrolling'))
      .catch(err => console.error("Error starting Instagram scroll:", err));
  }

  function stopResumeScrolling() {
    browser.tabs.query({ active: true, currentWindow: true })
      .then(tabs => {
        const tabId = tabs[0]?.id;
        if (tabId == null) return;
        if (scrollStatus === 'scrolling') {
          return browser.tabs.sendMessage(tabId, { action: "stopScrolling" })
            .then(() => setScrollStatus('paused'));
        } else if (scrollStatus === 'paused') {
          return browser.tabs.sendMessage(tabId, { action: "resumeScrolling" })
            .then(() => setScrollStatus('scrolling'));
        }
      })
      .catch(err => console.error("Error in stop/resume:", err));
  }

  return { scrollStatus, timeRemaining, startScrolling, stopResumeScrolling, startInstagramScrolling };
}


