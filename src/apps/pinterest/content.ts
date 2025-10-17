import browser from 'webextension-polyfill';

/**
 * Return true only on the base Pinterest page (path "/"), regardless of query/hash.
 * Works for subdomains like ca.pinterest.com too.
 */
function isPinterestRoot(): boolean {
  try {
    const u = new URL(location.href);
    if (!/pinterest\./.test(u.hostname)) return false;
    // Only when exactly "/" (queries like ?boardId=... are fine)
    return u.pathname === '/';
  } catch {
    return false;
  }
}

/**
 * Find the selected tab label by looking for <a aria-current="page"> in the header tabs.
 * We prefer anchors that look like the top tabs (homefeed or boardId), but fall back gracefully.
 */
function getSelectedTabLabel(): string {
  // Prefer obvious top-tab anchors
  const anchors = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a[aria-current="page"]')
  );

  // Try to pick the tab that matches homefeed or board context first
  const preferred = anchors.find(a => {
    const id = a.id || '';
    const href = a.getAttribute('href') || '';
    return (
      id === 'homefeed' ||
      /^\d+$/.test(id) ||                    // numeric board id as element id
      /[?&]boardId=/.test(href || '')       // boardId in href
    );
  });

  const chosen = preferred || anchors[0];
  if (!chosen) return '';

  // Text content of the tab ("All", "Art", "Dark fantasy", etc.)
  const label = (chosen.textContent || '').trim().replace(/\s+/g, ' ');
  return label;
}

let initialized = false;

export function initPinterestContent() {
  if (initialized) return;
  initialized = true;

  // Answer popup queries
  browser.runtime.onMessage.addListener((message: any) => {
    if (message?.action === 'pinterestGetSection') {
      if (!isPinterestRoot()) {
        return { section: '' };
      }
      return { section: getSelectedTabLabel() };
    }
    return undefined;
  });
}
