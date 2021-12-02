export type Track = {
  id: string;
  fid: string;
  path: string;
  metadata: TrackMetadata;
  settings: TrackSettings;
  listenEntries: ListenEntry[];
};

export interface ListenEntry
{
  started: number; // timestamp
  ended: number;
}

type Diff<T extends string | number | symbol, U extends string> = (
  { [P in T]: P }
  & { [P in U]: never }
  & { [x: string]: never }
  & { [x: number]: never }
)[T];

export const metadataKeys = [
  'title',
  'artist',
  'album',
  'length',
  'track',
  'modified',
] as const;

type MetadataKey = typeof metadataKeys[number];

export interface TrackMetadata
{
  title: string,
  artist: string,
  album: string,
  length: number,
  track: number;
  modified: string;
}

export type TrackSettings = {
  volume: number; // multiplier
};

export interface Playlist
{
    version: 1;
    tracks: string[]; // fids
    filename: string;
    name: string;
}