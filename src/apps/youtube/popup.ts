export function isYouTubeChannelVideosUrl(url: string) {
    return /^https:\/\/www\.youtube\.com\/@[^/]+\/videos\/?$/.test(url);
}

export function getYouTubePageTitle(url: string) {
    try {
      const u = new URL(url);
      // For watch pages we defer to content-script scraping, so keep it generic here:
      if (u.pathname === "/watch") return "YouTube Page";
      // Channel root like /@handle or /@handle/videos
      const handle = u.pathname.match(/^\/@([^/]+)/)?.[1];
      if (handle) return `YouTube Channel: ${handle}`;
    } catch {}
    return "YouTube Page";
}

