import browser from 'webextension-polyfill';

export function initYouTubeContent() {
  if (!/\.youtube\./.test(location.hostname)) return;

  function extractChannelInfo() {
    let name = '';
    let handle = '';

    // Handle from URL like /@handle
    const urlHandle = location.pathname.match(/\/(@[A-Za-z0-9._-]+)/);
    if (urlHandle) handle = urlHandle[1];

    // Channel page header
    const nameEl =
      (document.querySelector('#channel-name #text') as HTMLElement | null) ||
      (document.querySelector('ytd-channel-name #text') as HTMLElement | null);
    if (nameEl?.textContent) name = nameEl.textContent.trim();

    // Watch page owner block
    if (!name) {
      const owner =
        (document.querySelector('#owner #channel-name a') as HTMLAnchorElement | null) ||
        (document.querySelector('ytd-video-owner-renderer a.yt-simple-endpoint') as HTMLAnchorElement | null);
      if (owner) {
        name = (owner.textContent || '').trim();
        if (!handle) {
          const href = owner.getAttribute('href') || '';
          const m = href.match(/\/(@[A-Za-z0-9._-]+)/);
          if (m) handle = m[1];
        }
      }
    }

    // Meta fallback
    if (!name) {
      const meta =
        (document.querySelector('meta[itemprop="name"]') as HTMLMetaElement | null) ||
        (document.querySelector('meta[property="og:title"]') as HTMLMetaElement | null);
      if (meta?.content) name = meta.content.trim();
    }

    return { name, handle };
  }

  // Answer explicit requests
  browser.runtime.onMessage.addListener((message: any) => {
    if (message?.action !== 'ytGetChannelInfo') return;
    return extractChannelInfo(); // polyfill will resolve this as a response
  });

  // Push updates when DOM changes
  const pushIfChanged = (() => {
    let last = '';
    return () => {
      const info = extractChannelInfo();
      const key = `${info.name}|${info.handle}`;
      if (key !== last) {
        last = key;
        browser.runtime
          .sendMessage({ type: 'ytChannelInfoPush', payload: info })
          .catch(() => {});
      }
    };
  })();

  pushIfChanged();
  const obs = new MutationObserver(() => pushIfChanged());
  obs.observe(document.documentElement, { childList: true, subtree: true });
}
