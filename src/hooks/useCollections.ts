import { useEffect, useState } from 'react';
import browser from 'webextension-polyfill';

export interface Bookmark {
  uuid: string;
  platform: 'tiktok' | 'instagram' | 'other';
  url: string;
  collection: string;
}

export interface CollectionStore {
  collections: { 
    [platform: string]: {
      [collectionName: string]: Bookmark[];
    };
  };
}

export function useCollections() {
  const [collectionStore, setCollectionStore] = useState<CollectionStore>({ collections: {} });

  useEffect(() => {
    browser.storage.local.get('allCollections')
      .then(data => {
        if (data.allCollections) {
          setCollectionStore(data.allCollections as CollectionStore);
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
    setCollectionStore(prevStore => {
      const newBookmarks: Bookmark[] = urls.map(url => ({
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
            ...(prevStore.collections[platform]?.[collectionName] || []),
            ...newBookmarks,
          ],
        },
      };

      const updatedStore = { collections: updatedCollections };
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
      const updatedStore = { collections: updatedPlatforms };
      saveCollections(updatedStore);
      return updatedStore;
    });
  };

  const getAllCollections = () => collectionStore.collections;

  const getCollectionsByPlatform = (platform: 'tiktok' | 'instagram' | 'other') => {
    return collectionStore.collections[platform] || {};
  };

  return {
    collectionStore,
    addBookmarksToCollection,
    deleteCollection,
    getAllCollections,
    getCollectionsByPlatform,
  };
}
