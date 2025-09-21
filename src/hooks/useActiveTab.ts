import { useEffect, useState } from 'react';
import browser from 'webextension-polyfill';

export function useActiveTab() {
  const [title, setTitle] = useState('Loading...');
  const [activeUrl, setActiveUrl] = useState('');

  useEffect(() => {
    browser.tabs.query({ active: true, currentWindow: true })
      .then(tabs => {
        if (tabs.length > 0) {
          const tab = tabs[0];
          if (tab.title) setTitle(tab.title);
          if (tab.url) setActiveUrl(tab.url);
        }
      })
      .catch(err => console.error('Error fetching tab info:', err));
  }, []);

  return { title, activeUrl };
}


