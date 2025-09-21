import { useEffect, useState } from 'react';
import browser from 'webextension-polyfill';

export interface Bookmark {
  uuid: string;
  platform: 'tiktok' | 'instagram' | 'other';
  url: string;
  collection: string;
}

export interface CollectionMeta {
  type: 'bookmarks' | 'profile';
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
  const [collectionStore, setCollectionStore] = useState<CollectionStore>({ collections: {}, meta: {} });

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
    setCollectionStore(updatedStore);
    browser.storage.local.set({ allCollections: updatedStore })
      .catch(err => console.error('Error saving collections:', err));
  };

  const addBookmarksToCollection = (
    platform: 'tiktok' | 'instagram' | 'other',
    collectionName: string,
    urls: string[]
  ) => {
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

  const ensureCollection = (
    platform: 'tiktok' | 'instagram' | 'other',
    collectionName: string,
    meta?: CollectionMeta
  ) => {
    setCollectionStore(prevStore => {
      const platformCollections = prevStore.collections[platform] || {};
      const already = !!platformCollections[collectionName];
      const updatedCollections = already
        ? prevStore.collections
        : {
            ...prevStore.collections,
            [platform]: {
              ...platformCollections,
              [collectionName]: [],
            }
          };
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

  const getAllCollections = () => collectionStore.collections;
  const getCollectionMeta = (platform: string, collectionName: string): CollectionMeta | undefined => {
    return collectionStore.meta?.[platform]?.[collectionName];
  };

  const getCollectionsByPlatform = (platform: 'tiktok' | 'instagram' | 'other') => {
    return collectionStore.collections[platform] || {};
  };

  return {
    collectionStore,
    addBookmarksToCollection,
    ensureCollection,
    deleteCollection,
    getAllCollections,
    getCollectionsByPlatform,
    getCollectionMeta,
  };
}
