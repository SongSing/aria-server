import { Track, TrackMetadata, TrackSettings } from "./lib/types";
import * as mm from "music-metadata";
import * as path from "path";
import * as fs from "fs";
import { bigintStat, bigintStatSync, filesFromDirectoryRS, getUserDataPath, keysOf, makeUserDataPath } from "./lib/utils";
import { mapObject } from "./lib/objectUtils";
import { escapeSqlString, sql, query as sqlQuery } from "./lib/dbsql";
import { spawnSync } from "child_process";
import db, { tables } from "./lib/db";

const formats = [ ".mp3", ".m4a", ".wav", ".flac" ];

export const DefaultMetadata: Partial<TrackMetadata> =
{
    title: "Unknown Title",
    artist: "Unknown Artist",
    album: "Unknown Album",
    track: -1,
};

export const DefaultTrackSettings: TrackSettings = {
  volume: 1
};

function migrate(metadata: Partial<TrackMetadata>): TrackMetadata
{
  // inject defaults //
  let toInject: Partial<TrackMetadata> = {};
  keysOf(DefaultMetadata).forEach((mdKey) =>
  {
    if (!Object.hasOwnProperty.call(ret, mdKey))
    {
      toInject[mdKey] = DefaultMetadata[mdKey] as any;
    }
  });
  
  const ret = { ...metadata, ...toInject } as TrackMetadata;

  // if (!ret.listenEntries && ret.plays && ret.length)
  // {
  //   ret.listenEntries = ret.plays.map((time) =>
  //   {
  //     return {
  //       startTime: time,
  //       duration: ret.length
  //     };
  //   });
  // }

  return ret;
}

class MetadataLoader
{
  queue: string[] = [];
  tracks: Omit<Track, 'id'>[] = [];
  n = 16;
  currentlyProcessing = 0;
  startedProcessing = 0;
  finishedProcessing = 0;

  constructor(private onFinish: (tracks: Omit<Track, 'id'>[]) => any)
  {

  }

  enqueue(filepath: string)
  {
    this.queue.push(filepath);
  }

  start()
  {
    if (this.queue.length === 0)
    {
      this.onFinish(this.tracks);
    }
    else
    {
      for (let i = 0; i < Math.min(this.queue.length, this.n); i++)
      {
        this.processNext();
      }
    }
  }

  private processNext()
  {
    if (this.startedProcessing >= this.queue.length) return;
    
    const filepath = this.queue[this.startedProcessing++];

    console.log(`processing ${this.startedProcessing}/${this.queue.length} (${filepath})`);

    const settings = DefaultTrackSettings;

    loadMetadataFromFile(filepath)
      .then(({ metadata, fid }) =>
      {
        const data: Omit<Track, 'id'> = {
          fid,
          path: filepath,
          settings,
          metadata,
          listenEntries: []
        };

        this.tracks.push(data);
        
        pathMap.set(fid, filepath);
    
        this.finishedProcessing++;
    
        if (this.finishedProcessing === this.queue.length)
        {
          this.onFinish(this.tracks);
        }
        else
        {
          this.processNext();
        }
      });
  }
}

export function loadMetadataFromFile(filepath: string): Promise<{ metadata: TrackMetadata, fid: string }>
{
  const fid = bigintStatSync(filepath).ino.toString();

  makeUserDataPath();
  const imgPath = path.join(getUserDataPath(), 'images');

  try { fs.unlinkSync(imgPath); } catch (e) {}
  try { fs.mkdirSync(imgPath); } catch (e) {}

  return new Promise((resolve: (value: { metadata: TrackMetadata, fid: string }) => void, reject) =>
  {
    mm.parseFile(filepath, {
      duration: true
    }).then((metadata) =>
    {
      let src = "";

      bigintStat(filepath, async (err, stats) =>
      {
        if (err)
        {
          reject(err);
        }
        else
        {
          const fid = stats.ino.toString();
          const ret = {
            album: metadata.common.album || DefaultMetadata.album!,
            artist: metadata.common.artist || DefaultMetadata.artist!,
            length: metadata.format.duration || 0,
            modified: stats.mtimeMs.toString(),
            title: metadata.common.title || DefaultMetadata.title!,
            track: metadata.common.track.no ?? -1,
          } as TrackMetadata;

          const query: string = `
            INSERT INTO tracks (fid, title, artist, album, length, track, modified)
            OUTPUT inserted.id
            VALUES (${fid}, ${escapeSqlString(ret.title)}, ${escapeSqlString(ret.artist)},
                      ${escapeSqlString(ret.album)}, ${ret.length},
                      ${ret.track}, ${ret.modified});
          `;
  
          const { id } = (await sqlQuery(query)).recordset[0];
  
          if (metadata.common.picture && metadata.common.picture[0])
          {
            let format = metadata.common.picture[0].format;
            format = format.substr(format.indexOf("/") + 1);
      
            src = path.join(imgPath, id + "." + format);

            fs.writeFile(src, metadata.common.picture[0].data, (err) => {
              if (err) reject(err);
            });
          }
    
          resolve({ metadata: ret, fid });
        }
      });
    });
  });
}

function cullDeleted(cache: Record<string, TrackMetadata>)
{
  let toDelete = [];
  for (const filepath in cache)
  {
    if (!fs.existsSync(filepath))
    {
      toDelete.push(filepath);
    }
  }
  toDelete.forEach(filepath => delete cache[filepath]);
}

// function migrateTracks() {
//   console.log('migrating...');
//   console.time('migrated tracks');

//   const all = dbHelper.getAllTracks();
//   const allData = mapObject(all, (value) => {
//     return trackData(value);
//   });

//   const entries = Object.entries(allData);

//   entries.forEach(([fid, trackData], i) => {
//     if (!trackData.listenEntries) {
//       dbHelper.setTrackData(fid, {
//         ...trackData,
//         listenEntries: []
//       });
//     }

//     if (i % 200 === 0) {
//       console.log(Math.round(i / entries.length * 100) + "%");
//     }
//   });

//   console.timeEnd('migrated tracks');
// }

/**
 * fid -> path
 */
export const pathMap = new Map<string, string>();

export async function initLibrary() {
  const libPaths = db.get('0.libraryPaths', { table: tables.settings }) as string[];
  const files: { filepath: string, stat: fs.Dirent }[] = [];
  libPaths.forEach((path) => {
    files.push(...filesFromDirectoryRS(path));
  });
  await loadTracks(files.map(f => f.filepath));
}

export function createThumbnails() {
  const python = spawnSync('py', [path.join(__dirname, '../src/lib/resizeImages.py')], {
    cwd: path.join(__dirname, '../')
  });

  console.log(python.output.toString());
  console.log('images resized');
}

/**
 * Will also create/update cache.
 * @param filepaths filepaths of the tracks
 */
export function loadTracks(filepaths: string[])
{
  return new Promise<void>(async (resolve, reject) => {
    pathMap.clear();
    console.time("loaded tracks");
    // cullDeleted(cache);
    const loader = new MetadataLoader(async (loadedTracks) =>
    {
      console.timeEnd("loaded tracks");
      // migrateTracks();
      
      createThumbnails();
      resolve();
    });
  
    filepaths = filepaths.filter(filepath => formats.includes(path.extname(filepath)));

    let max = filepaths.length;
    let counter = 0;
    const fidsToFind = {} as Record<string, bigint>;
    
    filepaths.forEach((filepath) => fidsToFind[filepath] = (bigintStatSync(filepath).ino));

    const query: string = `
      SELECT fid
        FROM tracks
        WHERE ${Object.values(fidsToFind).map(fid => `fid = ${fid}`).join(' OR ')}
    `;

    const foundFids = (await sqlQuery(query)).recordset.map(o => o.fid);

    filepaths.forEach((filepath) =>
    {
      const fid = fidsToFind[filepath].toString();
      if (foundFids.includes(fid)) {
        pathMap.set(fid, filepath);

        // mm.parseFile(filepath, {
        //   duration: false
        // }).then(async (metadata) => {
        //   const ret = {
        //     album: metadata.common.album || DefaultMetadata.album!,
        //     artist: metadata.common.artist || DefaultMetadata.artist!,
        //     title: metadata.common.title || DefaultMetadata.title!,
        //   } as TrackMetadata;

        //   const query: string = `
        //     UPDATE tracks
        //       SET title = ${escapeSqlString(ret.title)},
        //           artist = ${escapeSqlString(ret.artist)},
        //           album = ${escapeSqlString(ret.album)}
        //       OUTPUT inserted.title
        //       WHERE fid = ${fid}
        //   `;

        //   console.log((await sqlQuery(query)).recordset[0]);
        // });
      } else {
        loader.enqueue(filepath);
      }
    });
    
    loader.start();
    console.log("tracks found in cache: " + pathMap.size + "/" + filepaths.length);
  });
}