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

  async function startScrolling(waitTime: number) {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (tabId == null) return;
  
      // Preflight: make sure content script is alive on this page
      try {
        const pong = await browser.tabs.sendMessage(tabId, { action: "ping" }) as any;
        if (!pong || pong.status !== "pong") throw new Error("no pong");
      } catch (e) {
        console.error("Content script not reachable for startScrolling:", e);
        alert("This page isn't ready yet. Refresh the page and try again.");
        return;
      }
  
      await browser.tabs.sendMessage(tabId, { action: "startScrolling", waitTime });
      setScrollStatus('scrolling');
    } catch (err) {
      console.error("Error starting scroll:", err);
    }
  }


  async function startInstagramScrolling(waitTime: number) {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (tabId == null) return;
  
      try {
        const pong = await browser.tabs.sendMessage(tabId, { action: "ping" }) as any;
        if (!pong || pong.status !== "pong") throw new Error("no pong");
      } catch (e) {
        console.error("Content script not reachable for startInstagramScrolling:", e);
        alert("This Instagram tab isn't ready yet. Refresh the page and try again.");
        return;
      }
  
      await browser.tabs.sendMessage(tabId, { action: "startInstagramScrolling", waitTime });
      setScrollStatus('scrolling');
    } catch (err) {
      console.error("Error starting Instagram scroll:", err);
    }
  }

  async function startYouTubeScrolling(waitTime: number) {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (tabId == null) return;
  
      try {
        const pong = await browser.tabs.sendMessage(tabId, { action: "ping" }) as any;
        if (!pong || pong.status !== "pong") throw new Error("no pong");
      } catch (e) {
        console.error("Content script not reachable for startYouTubeScrolling:", e);
        alert("This YouTube tab isn't ready yet. Refresh the page and try again.");
        return;
      }
  
      await browser.tabs.sendMessage(tabId, { action: "startYouTubeScrolling", waitTime });
      setScrollStatus('scrolling');
    } catch (err) {
      console.error("Error starting YouTube scroll:", err);
    }
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

  function cancelScrolling() {
    browser.tabs.query({ active: true, currentWindow: true })
      .then(tabs => {
        const tabId = tabs[0]?.id;
        if (tabId == null) return;
        return browser.tabs.sendMessage(tabId, { action: "stopScrolling" });
      })
      .finally(() => {
        setScrollStatus('idle');
        setTimeRemaining(0);
      })
      .catch(err => console.error("Error canceling scroll:", err));
  }

  return { scrollStatus, timeRemaining, startScrolling, stopResumeScrolling, startInstagramScrolling, startYouTubeScrolling, cancelScrolling };
}


