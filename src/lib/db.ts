import { Database } from '@devsnowflake/quick.db';
import { DefaultMetadata, DefaultTrackSettings } from '../library';
import { ListenEntry, Track } from './types';

const db = new Database('aria.db');

export const tables = {
  settings: 'settings',
  songs: 'songs'
};

export default db;

export class dbHelper {
  public static getAllSongs<O extends (keyof Track)[] = []>(omit: O = [] as any): Record<string, Omit<Track, O[number]>> {
    const ret: Record<string, Omit<Track, O[number]>> = {};
    
    const all = db.all({ table: tables.songs });

    all.forEach((track, i) => {
      const id = track.ID;
      const song: Track = {...track.data, fid: id};
      const goodKeys = Object.keys(song).filter(key => !omit.includes(key as any));
      const data: Record<string, any> = {};

      goodKeys.forEach((key) => {
        data[key] = (song as any)[key]
      });
      
      ret[id] = data as Omit<Track, O[number]>;
    });

    return ret;
  }
}