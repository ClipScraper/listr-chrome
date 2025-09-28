import browser from 'webextension-polyfill';

export function initYouTubeContent() {
  if (!/\.youtube\./.test(location.hostname)) return;

  function extractChannelInfo() {
    let name = '';
    let handle = '';

    // Handle from URL like /@handle, /c/handle, or /channel/id
    const urlMatch = location.pathname.match(/^\/(@[^/]+)|\/c\/([^/]+)|\/channel\/([^/]+)/);
    const handleFromUrl = urlMatch ? urlMatch[1] || urlMatch[2] || urlMatch[3] : null;
    if (handleFromUrl) {
      handle = handleFromUrl;
    }

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
    if (message?.action === 'ytGetChannelInfo') {
      return Promise.resolve(extractChannelInfo());
    }

    if (message?.action === 'youtube_scrapeVideos') {
      const videos: { url:string; title:string }[] = [];
      const videoSelectors = [
        'ytd-rich-item-renderer',
        'ytd-video-renderer',
        'ytd-grid-video-renderer',
        'ytd-compact-video-renderer',
      ];
      const videoElements = document.querySelectorAll(videoSelectors.join(', '));

      videoElements.forEach(el => {
        const anchor = el.querySelector(
          'a#thumbnail, a.yt-lockup-view-model__content-image, a.ytd-thumbnail'
        ) as HTMLAnchorElement;
        const titleEl = el.querySelector(
          '#video-title, .yt-lockup-metadata-view-model__title'
        ) as HTMLElement;

        if (anchor?.href && titleEl?.innerText) {
          const url = new URL(anchor.href, location.origin).toString();
          const title = titleEl.innerText.trim();
          if (!videos.some(v => v.url === url)) {
            videos.push({ url, title });
          }
        }
      });

      const channelInfo = extractChannelInfo();
      return Promise.resolve({ videos, channelName: channelInfo.name || channelInfo.handle });
    }
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
