import { useEffect, useState } from 'react';
import browser from 'webextension-polyfill';

export interface Bookmark {
  uuid: string;
  platform: 'tiktok' | 'instagram' | 'youtube' | 'pinterest' | 'other';
  url: string;
  collection: string;
}

export interface CollectionMeta {
  type: 'bookmarks' | 'profile' | 'favorites' | 'liked' | 'reposts' | 'recommendation' | 'video' | 'playlist';
  handle: string; // collection name for bookmarks, username for profile
}

export interface CollectionStore {
  collections: { 
    [platform: string]: {
      [collectionName: string]: Bookmark[];
    };
  };
  meta?: {
    [platform: string]: {
      [collectionName: string]: CollectionMeta;
    };
  };
}

export function useCollections() {
  const [collectionStore, setCollectionStore] = useState<CollectionStore>({collections: {}, meta: {}});

  useEffect(() => {
    browser.storage.local.get('allCollections')
      .then(data => {
        if (data.allCollections) {
          const loaded = data.allCollections as CollectionStore;
          // ensure meta map exists
          if (!loaded.meta) loaded.meta = {};
          setCollectionStore(loaded);
        }
      })
      .catch(err => console.error('Error loading collections:', err));
  }, []);

  const saveCollections = (updatedStore: CollectionStore) => {
    // Persist only; state is already updated by the caller's setState
    browser.storage.local.set({ allCollections: updatedStore })
      .catch(err => console.error('Error saving collections:', err));
  };

  const addBookmarksToCollection = (platform: 'tiktok' | 'instagram' | 'youtube' | 'pinterest' | 'other', collectionName: string, urls: string[]) => {
    if (!urls || urls.length === 0) return;
    setCollectionStore(prevStore => {
      const currentList = prevStore.collections[platform]?.[collectionName] || [];
      const existing = new Set(currentList.map(b => b.url));
      const filtered = urls.filter(u => !existing.has(u));
      if (filtered.length === 0) return prevStore;

      const newBookmarks: Bookmark[] = filtered.map(url => ({
        uuid: crypto.randomUUID(),
        platform,
        url,
        collection: collectionName,
      }));

      const updatedCollections = {
        ...prevStore.collections,
        [platform]: {
          ...(prevStore.collections[platform] || {}),
          [collectionName]: [
            ...currentList,
            ...newBookmarks,
          ],
        },
      };

      const updatedStore: CollectionStore = { collections: updatedCollections, meta: prevStore.meta };
      saveCollections(updatedStore);
      return updatedStore;
    });
  };

  const ensureCollection = (platform: 'tiktok' | 'instagram' | 'youtube' | 'pinterest' | 'other', collectionName: string, meta?: CollectionMeta) => {
    setCollectionStore(prevStore => {
      const platformCollections = prevStore.collections[platform] || {};
      const already = !!platformCollections[collectionName];
      const updatedCollections = already ? prevStore.collections : {...prevStore.collections, [platform]: {...platformCollections, [collectionName]: []}};
      const updatedMeta = { ...(prevStore.meta || {}) } as NonNullable<CollectionStore['meta']>;
      if (!updatedMeta[platform]) updatedMeta[platform] = {};
      if (meta) {
        updatedMeta[platform][collectionName] = meta;
      } else if (!updatedMeta[platform][collectionName]) {
        updatedMeta[platform][collectionName] = { type: 'profile', handle: collectionName };
      }
      const updatedStore: CollectionStore = { collections: updatedCollections, meta: updatedMeta };
      saveCollections(updatedStore);
      return updatedStore;
    });
  };

  const deleteCollection = (platform: string, collectionName: string) => {
    setCollectionStore(prevStore => {
      const updatedPlatforms = { ...prevStore.collections };
      if (updatedPlatforms[platform]) {
        const updatedPlatformCollections = { ...updatedPlatforms[platform] };
        delete updatedPlatformCollections[collectionName];
        if (Object.keys(updatedPlatformCollections).length === 0) {
          delete updatedPlatforms[platform];
        } else {
          updatedPlatforms[platform] = updatedPlatformCollections;
        }
      }
      const updatedMeta = { ...(prevStore.meta || {}) } as NonNullable<CollectionStore['meta']>;
      if (updatedMeta[platform]) {
        const m = { ...updatedMeta[platform] };
        delete m[collectionName];
        updatedMeta[platform] = m;
      }
      const updatedStore: CollectionStore = { collections: updatedPlatforms, meta: updatedMeta };
      saveCollections(updatedStore);
      return updatedStore;
    });
  };

  const renameCollection = (platform: string, oldCollectionName: string, newCollectionName: string) => {
    if (oldCollectionName === newCollectionName) return;

    setCollectionStore(prevStore => {
      const updatedCollections = { ...prevStore.collections };
      const updatedMeta = { ...(prevStore.meta || {}) } as NonNullable<CollectionStore['meta']>;

      // Move bookmarks to new collection name
      if (updatedCollections[platform]?.[oldCollectionName]) {
        const bookmarks = updatedCollections[platform][oldCollectionName];

        // Update collection reference in each bookmark
        const updatedBookmarks = bookmarks.map(bookmark => ({
          ...bookmark,
          collection: newCollectionName
        }));

        // Remove old collection and add new one
        const platformCollections = { ...updatedCollections[platform] };
        delete platformCollections[oldCollectionName];
        platformCollections[newCollectionName] = updatedBookmarks;
        updatedCollections[platform] = platformCollections;
      }

      // Move metadata to new collection name
      if (updatedMeta[platform]?.[oldCollectionName]) {
        const meta = updatedMeta[platform][oldCollectionName];
        const platformMeta = { ...updatedMeta[platform] };
        delete platformMeta[oldCollectionName];
        platformMeta[newCollectionName] = meta;
        updatedMeta[platform] = platformMeta;
      }

      const updatedStore: CollectionStore = { collections: updatedCollections, meta: updatedMeta };
      saveCollections(updatedStore);
      return updatedStore;
    });
  };

  const getAllCollections = () => collectionStore.collections;
  const getCollectionMeta = (platform: string, collectionName: string): CollectionMeta | undefined => {
    return collectionStore.meta?.[platform]?.[collectionName];
  };

  const getCollectionsByPlatform = (platform: 'tiktok' | 'instagram' | 'youtube' | 'pinterest' | 'other') => {
    return collectionStore.collections[platform] || {};
  };

  return {collectionStore, addBookmarksToCollection, ensureCollection, deleteCollection, renameCollection, getAllCollections, getCollectionsByPlatform, getCollectionMeta};
}
