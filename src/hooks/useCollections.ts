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
          if (!loaded.meta) loaded.meta = {};
          setCollectionStore(loaded);
        }
      })
      .catch(err => console.error('Error loading collections:', err));
  }, []);

  const saveCollections = (updatedStore: CollectionStore) => {
    browser.storage.local.set({ allCollections: updatedStore })
      .catch(err => console.error('Error saving collections:', err));
  };

  // Insert a key at the *front* of an object (preserving order of the rest)
  function insertKeyFirst<T extends Record<string, any>>(obj: T, key: string, val: any): T {
    const out: Record<string, any> = { [key]: val };
    for (const k of Object.keys(obj)) out[k] = obj[k];
    return out as T;
  }

  const addBookmarksToCollection = (platform: 'tiktok' | 'instagram' | 'youtube' | 'pinterest' | 'other', collectionName: string, urls: string[]) => {
    if (!urls || urls.length === 0) return;
    setCollectionStore(prevStore => {
      const platformMap = prevStore.collections[platform] || {};
      const currentList = platformMap[collectionName] || [];
      const existing = new Set(currentList.map(b => b.url));
      const filtered = urls.filter(u => !existing.has(u));
      if (filtered.length === 0) return prevStore;

      const newBookmarks: Bookmark[] = filtered.map(url => ({
        uuid: crypto.randomUUID(),
        platform,
        url,
        collection: collectionName,
      }));

      let nextPlatformMap: typeof platformMap;
      if (!platformMap[collectionName]) {
        // New collection: place it at the top
        nextPlatformMap = insertKeyFirst(platformMap, collectionName, newBookmarks);
      } else {
        // Existing collection: append items
        nextPlatformMap = { ...platformMap, [collectionName]: [...currentList, ...newBookmarks] };
      }

      const updatedCollections = { ...prevStore.collections, [platform]: nextPlatformMap };
      const updatedStore: CollectionStore = { collections: updatedCollections, meta: prevStore.meta };
      saveCollections(updatedStore);
      return updatedStore;
    });
  };

  const ensureCollection = (platform: 'tiktok' | 'instagram' | 'youtube' | 'pinterest' | 'other', collectionName: string, meta?: CollectionMeta) => {
    setCollectionStore(prevStore => {
      const platformCollections = prevStore.collections[platform] || {};
      const already = !!platformCollections[collectionName];

      // Put new collections at the front
      const nextPlatformCollections = already
        ? platformCollections
        : insertKeyFirst(platformCollections, collectionName, []);

      // Meta handling (also keep new meta at the front for consistency)
      const updatedMeta = { ...(prevStore.meta || {}) } as NonNullable<CollectionStore['meta']>;
      if (!updatedMeta[platform]) updatedMeta[platform] = {};
      if (!already) {
        updatedMeta[platform] = insertKeyFirst(
          updatedMeta[platform],
          collectionName,
          meta || { type: 'profile', handle: collectionName }
        );
      } else if (meta) {
        updatedMeta[platform] = { ...updatedMeta[platform], [collectionName]: meta };
      }

      const updatedCollections = { ...prevStore.collections, [platform]: nextPlatformCollections };
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

      // Move bookmarks to new collection name (keep it at same relative position)
      if (updatedCollections[platform]?.[oldCollectionName]) {
        const bookmarks = updatedCollections[platform][oldCollectionName];
        const updatedBookmarks = bookmarks.map(bookmark => ({
          ...bookmark,
          collection: newCollectionName
        }));

        const platformCollections = { ...updatedCollections[platform] };
        delete platformCollections[oldCollectionName];
        // Put the renamed collection at the *front* as a “new” row feeling
        updatedCollections[platform] = insertKeyFirst(platformCollections, newCollectionName, updatedBookmarks);
      }

      // Move metadata
      if (updatedMeta[platform]?.[oldCollectionName]) {
        const meta = updatedMeta[platform][oldCollectionName];
        const platformMeta = { ...updatedMeta[platform] };
        delete platformMeta[oldCollectionName];
        updatedMeta[platform] = insertKeyFirst(platformMeta, newCollectionName, meta);
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
