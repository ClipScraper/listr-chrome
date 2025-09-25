import browser from "webextension-polyfill";

type YtChannelInfo = { name?: string; handle?: string; channelUrl?: string };

let lastKnown: YtChannelInfo = {};
let mo: MutationObserver | null = null;

const MATCH_PREFIXES = ["/@", "/channel/", "/c/", "/user/"];

function isChannelHref(href: string | null | undefined) {
  if (!href) return false;
  return MATCH_PREFIXES.some(p => href.startsWith(p));
}

function abs(url: string) {
  try { return new URL(url, location.origin).toString(); } catch { return url; }
}

function pickName(a: HTMLAnchorElement | null): string | undefined {
  if (!a) return undefined;
  const t = (a.textContent || "").trim();
  if (t) return t;
  // Often the yt-formatted-string carries a title="Channel Name"
  const ytf = a.closest("yt-formatted-string") as HTMLElement | null;
  const titleAttr = ytf?.getAttribute("title")?.trim();
  return titleAttr || undefined;
}

function scanOnce(): YtChannelInfo | null {
  const selectors: string[] = [
    // Most reliable on watch pages
    'ytd-watch-metadata ytd-video-owner-renderer ytd-channel-name yt-formatted-string#text a',
    'ytd-watch-metadata ytd-video-owner-renderer ytd-channel-name a',
    '#owner ytd-channel-name yt-formatted-string#text a',
    'ytd-video-owner-renderer a.yt-simple-endpoint.yt-formatted-string',
    // Broad fallback
    'ytd-channel-name #text a',
    'a.yt-simple-endpoint[href*="/@"], a.yt-simple-endpoint[href*="/channel/"], a.yt-simple-endpoint[href*="/c/"], a.yt-simple-endpoint[href*="/user/"]',
  ];

  for (const sel of selectors) {
    const a = document.querySelector<HTMLAnchorElement>(sel);
    const ok = isChannelHref(a?.getAttribute("href") || a?.href);
    // Debug
    console.log("[YT CS] selector:", sel, "=>", ok, pickName(a), a?.getAttribute("href") || a?.href);

    if (ok && a) {
      const href = a.getAttribute("href") || a.href;
      const channelUrl = abs(href);
      const name = pickName(a);
      let handle: string | undefined;

      if (href.startsWith("/@")) {
        handle = href.replace(/^\/@/, "").replace(/\/.*$/, "");
      } else if (href.startsWith("/channel/")) {
        // Use channel ID as a stable handle-like value
        handle = href.replace(/^\/channel\//, "").replace(/\/.*$/, "");
      } else if (href.startsWith("/c/")) {
        handle = href.replace(/^\/c\//, "").replace(/\/.*$/, "");
      } else if (href.startsWith("/user/")) {
        handle = href.replace(/^\/user\//, "").replace(/\/.*$/, "");
      }

      return { name, handle, channelUrl };
    }
  }
  return null;
}

function updateLastKnown() {
    const found = scanOnce();
    if (found && (found.name || found.handle)) {
      lastKnown = found;
      console.log("[YT CS] observer updated lastKnown:\n", lastKnown);
  
      // NEW: push to the extension so the popup can update immediately
      try {
        browser.runtime.sendMessage({ type: "ytChannelInfoPush", payload: lastKnown }).catch(() => {});
      } catch {}
    }
}

export function initYouTubeContent() {
  // Initial sweep
  updateLastKnown();

  // Observe dynamic swaps on watch pages
  try {
    mo?.disconnect();
    mo = new MutationObserver(() => updateLastKnown());
    mo.observe(document.documentElement, { subtree: true, childList: true, attributes: false });
  } catch (e) {
    console.warn("[YT CS] MutationObserver error", e);
  }

  // Answer popup queries
  browser.runtime.onMessage.addListener((message: any) => {
    if (message?.action !== "ytGetChannelInfo") return undefined;

    // Always attempt a fresh scan to be current
    const now = scanOnce();
    const payload = now && (now.name || now.handle) ? now : lastKnown;
    console.log("[YT CS] ytGetChannelInfo received");
    console.log("[YT CS] returning:", payload);
    return payload;
  });
}
