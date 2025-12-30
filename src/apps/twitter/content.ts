import browser from 'webextension-polyfill';

// Twitter incremental collection state
const collectedTwitterLinks = new Set<string>();

export type TwitterItem = {
  url: string;
  userHandle: string;
  userName: string;
  text: string;
};

const collectedTwitterItems: TwitterItem[] = [];

function toAbsoluteTwitterUrl(pathOrUrl: string): string | null {
  try {
    // Clean the input
    let cleanPath = pathOrUrl.trim();
    if (!cleanPath) return null;
    
    // If it's already a full URL, parse it directly
    let u: URL;
    if (cleanPath.startsWith('http://') || cleanPath.startsWith('https://')) {
      u = new URL(cleanPath);
    } else {
      // It's a relative path, resolve it relative to x.com
      u = new URL(cleanPath, 'https://x.com');
    }
    
    // Accept both x.com and twitter.com
    if (!/\.(x\.com|twitter\.com)$/.test(u.hostname)) return null;
    
    // Normalize the pathname - ensure it doesn't have trailing slash for status URLs
    // Status URLs should be: https://x.com/username/status/1234567890
    let pathname = u.pathname;
    // Remove trailing slash unless it's just "/"
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    u.pathname = pathname;
    u.hash = '';
    u.search = '';
    
    return u.toString();
  } catch (error) {
    console.error('Error normalizing Twitter URL:', pathOrUrl, error);
    return null;
  }
}

function extractTweetData(tweetElement: HTMLElement, statusUrl?: string): TwitterItem | null {
  try {
    // Handle case where statusUrl is already provided (from the link we found)
    let href = '';
    let statusLink: HTMLAnchorElement | null = null;
    
    if (statusUrl) {
      // We already have the URL, try to find the link element
      const statusId = statusUrl.split('/status/')[1]?.split('/')[0];
      if (statusId) {
        statusLink = tweetElement.querySelector<HTMLAnchorElement>(`a[href*="/status/${statusId}"]`);
        if (statusLink) {
          href = statusLink.getAttribute('href') || '';
        }
      }
      // If we couldn't find the link, that's okay - we'll still extract what we can
    } else {
      // Handle case where tweetElement itself is a link
      if (tweetElement.tagName === 'A' && tweetElement.getAttribute('href')?.includes('/status/')) {
        statusLink = tweetElement as HTMLAnchorElement;
        href = statusLink.getAttribute('href') || '';
      } else {
        // Find the status link - pattern: /{username}/status/{id}
        // Look for anchor with href containing "/status/"
        statusLink = tweetElement.querySelector<HTMLAnchorElement>('a[href*="/status/"]');
        if (!statusLink) return null;
        href = statusLink.getAttribute('href') || '';
      }
      
      if (!href || !href.includes('/status/')) return null;
      
      // Extract status URL - normalize it
      const normalizedUrl = toAbsoluteTwitterUrl(href);
      if (!normalizedUrl) return null;
      statusUrl = normalizedUrl;
    }
    
    // Ensure we have a statusUrl at this point
    if (!statusUrl) return null;
    
    // Skip if already collected
    if (collectedTwitterLinks.has(statusUrl)) return null;
    
    // If the container is very large (like main or body), we need to find a smaller sub-container
    // that contains this specific link and its associated tweet data
    let searchContainer = tweetElement;
    if (tweetElement.tagName === 'MAIN' || tweetElement.tagName === 'BODY' || tweetElement.tagName === 'HTML') {
      // Find a more specific container for this tweet
      // Look for a parent of the link that contains tweet-like content
      let current: HTMLElement | null = statusLink ? statusLink.parentElement : null;
      let depth = 0;
      while (current && current !== tweetElement && depth < 15) {
        const textLength = (current.textContent || '').trim().length;
        const hasTweetMetadata = current.querySelector('[data-testid="User-Name"], [data-testid="tweetText"]') !== null;
        // Use this container if it has tweet metadata or substantial text but isn't too large
        if ((hasTweetMetadata || (textLength > 50 && textLength < 5000)) && current.children.length < 50) {
          searchContainer = current;
          break;
        }
        current = current.parentElement;
        depth++;
      }
      // If we didn't find a better container, use the original
      if (searchContainer === tweetElement && current && current !== tweetElement) {
        searchContainer = current;
      }
    }
    
    // Extract username from href pattern: /{username}/status/{id}
    let userHandle = '';
    const match = href.match(/\/status\//);
    if (match) {
      // Extract username from path before /status/
      const pathParts = href.split('/status/')[0].split('/').filter(Boolean);
      if (pathParts.length > 0) {
        const username = pathParts[pathParts.length - 1];
        if (username && /^[a-zA-Z0-9_]+$/.test(username)) {
          userHandle = `@${username}`;
        }
      }
    }
    
    // Alternative: find handle from links - look for links to user profiles
    if (!userHandle) {
      // Look for links that go to user profiles (not status pages)
      const userLinks = searchContainer.querySelectorAll<HTMLAnchorElement>('a[href^="/"]');
      for (const link of Array.from(userLinks)) {
        const linkHref = link.getAttribute('href') || '';
        // Check if it's a user profile link (not status, not photo, etc.)
        if (linkHref && !linkHref.includes('/status/') && !linkHref.includes('/photo/') && 
            linkHref.split('/').filter(Boolean).length === 1) {
          const linkText = (link.textContent || '').trim();
          // Check if the link text contains @username
          if (linkText.startsWith('@') && /^@[a-zA-Z0-9_]+$/.test(linkText)) {
            userHandle = linkText;
            break;
          }
          // Or extract from href
          const username = linkHref.replace(/^\//, '');
          if (username && /^[a-zA-Z0-9_]+$/.test(username)) {
            userHandle = `@${username}`;
            break;
          }
        }
      }
    }
    
    // Alternative: find handle from text content (look for @username pattern)
    if (!userHandle) {
      const handleElements = searchContainer.querySelectorAll('span, a');
      for (const el of Array.from(handleElements)) {
        const text = (el.textContent || '').trim();
        if (text.startsWith('@') && text.length > 1 && text.length < 30 && /^@[a-zA-Z0-9_]+$/.test(text)) {
          userHandle = text;
          break;
        }
      }
    }
    
    // Find user name from [data-testid="User-Name"] container
    let userName = '';
    const nameContainer = searchContainer.querySelector('[data-testid="User-Name"]');
    if (nameContainer) {
      // Look for the first span that contains the display name
      // The name is usually in a span with dir="ltr" that doesn't start with @
      const nameSpans = nameContainer.querySelectorAll('span');
      for (const span of Array.from(nameSpans)) {
        const text = (span.textContent || '').trim();
        // Skip if it's the handle, empty, or too long
        if (text && !text.startsWith('@') && text.length > 0 && text.length < 100) {
          // Check if this span contains only text (no nested images/svgs that would indicate it's an emoji or icon)
          // But allow for emoji characters in the text itself
          const nestedElements = span.querySelector('img, svg');
          if (!nestedElements) {
            // This looks like a name span - take the first meaningful text
            // But skip if it's just punctuation or very short
            if (text.length > 1 && !/^[·\s]+$/.test(text)) {
              userName = text;
              break;
            }
          }
        }
      }
      
      // If we didn't find it in spans, try getting text directly from the container
      if (!userName) {
        const containerText = (nameContainer.textContent || '').trim();
        // Extract the first non-handle text
        const parts = containerText.split(/\s+/);
        for (const part of parts) {
          if (part && !part.startsWith('@') && part.length > 1 && part.length < 50) {
            userName = part;
            break;
          }
        }
      }
    }
    
    // Alternative: try to find name from links or other elements
    if (!userName) {
      // Look for links that might contain the user's display name
      const userLinks = searchContainer.querySelectorAll<HTMLAnchorElement>('a[href^="/"]');
      for (const link of Array.from(userLinks)) {
        const linkText = (link.textContent || '').trim();
        if (linkText && !linkText.startsWith('@') && linkText.length > 0 && linkText.length < 100) {
          const hrefAttr = link.getAttribute('href') || '';
          // If this link goes to a user profile (not status), it might be the name
          if (hrefAttr && !hrefAttr.includes('/status/') && hrefAttr.split('/').filter(Boolean).length <= 2) {
            userName = linkText;
            break;
          }
        }
      }
    }
    
    // Find tweet text from [data-testid="tweetText"]
    let text = '';
    const tweetTextElement = searchContainer.querySelector('[data-testid="tweetText"]');
    if (tweetTextElement) {
      text = (tweetTextElement.textContent || '').trim();
    }
    
    // If we have a status URL, create the item even if some fields are missing
    if (statusUrl) {
      return {
        url: statusUrl,
        userHandle: userHandle || 'unknown',
        userName: userName || 'unknown',
        text: text || '',
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error extracting tweet data:', error);
    return null;
  }
}

function scanAndCollectTwitterTweets(logEach: boolean = true): TwitterItem[] {
  if (!/\.(x\.com|twitter\.com)$/.test(location.hostname)) {
    if (logEach) console.log('Twitter scan: Not on Twitter/X domain');
    return [];
  }
  
  const newlyFound: TwitterItem[] = [];
  
  // Strategy 1: Find all article elements with data-testid="tweet" first
  // This is the most reliable way to find tweets
  const articles = document.querySelectorAll<HTMLElement>('article[data-testid="tweet"]');
  
  if (logEach) {
    console.log(`Twitter scan: Found ${articles.length} tweet articles on page`);
  }
  
  articles.forEach((article, index) => {
    // Find the status link within this article
    const statusLink = article.querySelector<HTMLAnchorElement>('a[href*="/status/"]');
    if (!statusLink) {
      if (logEach && index < 3) {
        console.log(`Twitter scan: Article ${index} has no status link`);
      }
      return;
    }
    
    const href = statusLink.getAttribute('href') || '';
    if (!href || !href.includes('/status/')) return;
    
    // Normalize the URL
    const statusUrl = toAbsoluteTwitterUrl(href);
    if (!statusUrl) {
      if (logEach && index < 5) {
        console.log(`Twitter scan: Failed to normalize URL: ${href}`);
      }
      return;
    }
    
    // Skip if already collected
    if (collectedTwitterLinks.has(statusUrl)) return;
    
    // Extract tweet data directly from the article
    const item = extractTweetData(article, statusUrl);
    
    // If extraction failed, create a minimal item with URL and username from href
    if (!item) {
      // Extract username from URL as fallback
      const pathParts = href.split('/status/')[0].split('/').filter(Boolean);
      const username = pathParts.length > 0 ? pathParts[pathParts.length - 1] : '';
      const userHandle = username && /^[a-zA-Z0-9_]+$/.test(username) ? `@${username}` : 'unknown';
      
      const fallbackItem: TwitterItem = {
        url: statusUrl,
        userHandle: userHandle,
        userName: 'unknown',
        text: '',
      };
      
      collectedTwitterLinks.add(statusUrl);
      collectedTwitterItems.push(fallbackItem);
      newlyFound.push(fallbackItem);
      if (logEach) {
        console.log(`Twitter scan: Added tweet ${newlyFound.length} (fallback):`, fallbackItem);
      }
      return;
    }
    
    // Add the item if we have a valid URL and it's not already collected
    if (item && item.url === statusUrl && !collectedTwitterLinks.has(item.url)) {
      collectedTwitterLinks.add(item.url);
      collectedTwitterItems.push(item);
      newlyFound.push(item);
      if (logEach) {
        console.log(`Twitter scan: Added tweet ${newlyFound.length}:`, item);
      }
    } else if (logEach && index < 5) {
      if (!item) {
        console.log(`Twitter scan: Failed to extract data for ${statusUrl}`);
      } else if (collectedTwitterLinks.has(item.url)) {
        // Already collected, skip logging
      }
    }
  });
  
  // Fallback: Also check for status links that might not be in articles
  if (newlyFound.length === 0) {
    const statusLinks = document.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]');
    if (logEach) {
      console.log(`Twitter scan: No articles found, checking ${statusLinks.length} status links directly`);
    }
    statusLinks.forEach((link, index) => {
      const href = link.getAttribute('href') || '';
      if (!href || !href.includes('/status/')) return;
      
      const statusUrl = toAbsoluteTwitterUrl(href);
      if (!statusUrl || collectedTwitterLinks.has(statusUrl)) return;
      
      // Extract username from URL
      const pathParts = href.split('/status/')[0].split('/').filter(Boolean);
      const username = pathParts.length > 0 ? pathParts[pathParts.length - 1] : '';
      const userHandle = username && /^[a-zA-Z0-9_]+$/.test(username) ? `@${username}` : 'unknown';
      
      const item: TwitterItem = {
        url: statusUrl,
        userHandle: userHandle,
        userName: 'unknown',
        text: '',
      };
      
      collectedTwitterLinks.add(statusUrl);
      collectedTwitterItems.push(item);
      newlyFound.push(item);
      if (logEach && index < 10) {
        console.log(`Twitter scan: Added tweet ${newlyFound.length} (from link):`, item);
      }
    });
  }
  
  if (logEach) {
    if (newlyFound.length === 0) {
      console.log(`Twitter scan: No new tweets found. Total articles: ${articles.length}, Already collected: ${collectedTwitterLinks.size}`);
    } else {
      console.log(`Twitter scan: Found ${newlyFound.length} new tweets. Total collected: ${collectedTwitterLinks.size}`);
    }
  }
  
  return newlyFound;
}

export function onScrollTickTwitter() {
  const newly = scanAndCollectTwitterTweets(true);
  if (newly.length > 0) {
    try {
      browser.runtime.sendMessage({ 
        type: 'twitterNewLinks', 
        items: newly.map(item => ({
          url: item.url,
          userHandle: item.userHandle,
          userName: item.userName,
          text: item.text,
        }))
      }).catch(() => {});
    } catch {}
  }
}

let initialized = false;
export function initTwitterContent() {
  if (initialized) return;
  initialized = true;

  browser.runtime.onMessage.addListener((message: any) => {
    if (message.action === 'collectTwitterTweets') {
      // Final collection
      scanAndCollectTwitterTweets(false);
      return { items: [...collectedTwitterItems] };
    }
    if (message.action === 'resetTwitterState') {
      collectedTwitterLinks.clear();
      collectedTwitterItems.length = 0;
      return { status: 'cleared' };
    }
    if (message.action === 'scanTwitterOnce') {
      const items = scanAndCollectTwitterTweets(true);
      return { items };
    }
    return undefined;
  });
}

