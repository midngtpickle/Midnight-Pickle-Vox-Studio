import { GeneratedAudio } from '../types';

const DB_NAME = 'voxgemini_history';
const DB_VERSION = 1;
const STORE_NAME = 'audio_history';

interface StoredAudio {
  id: string;
  text: string;
  style: string;
  voice: string;
  timestamp: number;
  sampleRate: number;
  length: number;
  numberOfChannels: number;
  channelsData: Float32Array[];
  peaks?: number[];
}

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
};

export const saveHistoryItem = async (item: GeneratedAudio): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const channelsData: Float32Array[] = [];
    if (item.buffer) {
       for (let i = 0; i < item.buffer.numberOfChannels; i++) {
         channelsData.push(item.buffer.getChannelData(i));
       }
    } else {
       return reject(new Error("Cannot save item without buffer"));
    }

    const record: StoredAudio = {
      id: item.id,
      text: item.text,
      style: item.style,
      voice: item.voice,
      timestamp: item.timestamp,
      sampleRate: item.buffer.sampleRate,
      length: item.buffer.length,
      numberOfChannels: item.buffer.numberOfChannels,
      channelsData,
      peaks: item.peaks
    };

    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const loadHistoryFromDB = async (ctx: AudioContext | null, loadBuffers: boolean = false): Promise<GeneratedAudio[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const records: StoredAudio[] = request.result;
      records.sort((a, b) => b.timestamp - a.timestamp);

      const items: GeneratedAudio[] = records.map(record => {
        let buffer: AudioBuffer | undefined;
        
        if (loadBuffers && ctx) {
           buffer = ctx.createBuffer(
             record.numberOfChannels,
             record.length,
             record.sampleRate
           );
           for (let i = 0; i < record.numberOfChannels; i++) {
             buffer.getChannelData(i).set(record.channelsData[i]);
           }
        }

        return {
          id: record.id,
          text: record.text,
          style: record.style,
          voice: record.voice as any,
          timestamp: record.timestamp,
          peaks: record.peaks,
          buffer, // Undefined if we want to save memory until requested
        };
      });

      resolve(items);
    };
    request.onerror = () => reject(request.error);
  });
};

export const loadAudioBufferFromDB = async (id: string, ctx: AudioContext): Promise<AudioBuffer | null> => {
   const db = await openDB();
   return new Promise((resolve, reject) => {
     const tx = db.transaction(STORE_NAME, 'readonly');
     const store = tx.objectStore(STORE_NAME);
     const request = store.get(id);
     
     request.onsuccess = () => {
        const record: StoredAudio = request.result;
        if (!record) return resolve(null);
        
        const buffer = ctx.createBuffer(
           record.numberOfChannels,
           record.length,
           record.sampleRate
        );
        for (let i = 0; i < record.numberOfChannels; i++) {
           buffer.getChannelData(i).set(record.channelsData[i]);
        }
        resolve(buffer);
     };
     request.onerror = () => reject(request.error);
   });
};

export const deleteHistoryItemDB = async (id: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const clearAllHistoryDB = async (): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};
