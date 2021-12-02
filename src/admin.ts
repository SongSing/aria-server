import db, { dbHelper, tables } from './lib/db';
import { initDb, ListenEntryModel, ListenEntryImpl, sequelize, TrackImpl, TrackModel, PlaylistModel } from './lib/dbsql';
import * as fs from 'fs';
import { Model, Op, QueryTypes, Sequelize } from 'sequelize/dist';
import { bigintStatSync, filesFromDirectoryR, filesFromDirectoryRS, getUserDataPath, makeUserDataPath } from './lib/utils';
import * as mm from "music-metadata";
import path from 'path';
import { spawn, spawnSync } from 'child_process';

async function newListens() {
  await sequelize.authenticate();
  const newTracks = dbHelper.getAllSongs();

  type Create = Omit<TrackImpl, 'asTrack' | 'metadata' | 'settings' | 'listenEntries' | 'id'>;

  await initDb();

  await (async () => {
    Object.entries(newTracks).forEach(async ([fid, track], i) => {
      const trackAttrs: Create = {
        ...track.metadata,
        ...track.settings,
        fid: fid
      };

      track.listenEntries.forEach(async (le) => {
        const start = new Date((le as any).startTime);
        const end = new Date((le as any).startTime);
        end.setSeconds(end.getSeconds() + (le as any).duration);
        
        const item = {
          started: start.toISOString(),
          ended: end.toISOString(),
          trackId: (await TrackModel.findOne({ where: { fid } }))!.get('id')
        };

        ListenEntryModel.create(item);

        // console.log(larr[larr.length - 1]);
      });
    });
  })();
}

async function init() {
  await sequelize.authenticate();

  type Create = Omit<TrackImpl, 'asTrack' | 'metadata' | 'settings' | 'listenEntries' | 'id'>;
  
  const newTracks = dbHelper.getAllSongs();
  const arr: Create[] = [];

  await sequelize.sync({
    force: true
  });

  await (async () => {
    Object.entries(newTracks).forEach(async ([fid, track], i) => {
      const trackAttrs: Create = {
        ...track.metadata,
        ...track.settings,
        fid: fid
      };

      arr.push(trackAttrs);

      console.log(`${i} / ${Object.entries(newTracks).length}`);
    });
  })();

  await TrackModel.bulkCreate(arr);

  ////

  const json = JSON.parse(fs.readFileSync('D:\\Electron\\aria4\\songcache.json', 'utf8'));
  const bulk: ListenEntryImpl[] = [];

  const fidsToFind: string[] = [];

  Object.entries<TopLevel>(json).forEach(([fid, data]) => {
    const les = data.listenEntries;
    if (les.length > 0) {
      fidsToFind.push(fid);
    }
  });

  TrackModel.findAll({
    where: {
      fid: {
        [Op.or]: Array.from(fidsToFind)
      }
    }
  }).then((tracks) => {
    const obj: Record<string, TrackImpl & {id: number}> = {};

    tracks.forEach((track) => {
      obj[track.get('fid') as any] = track.toJSON();
    });

    Object.entries<TopLevel>(json).forEach(([fid, data]) => {
      data.listenEntries.forEach((le) => {
        const start = new Date(le.startTime);
        const end = new Date(le.startTime);
        end.setSeconds(end.getSeconds() + le.duration);
        
        const item = {
          started: start.toISOString(),
          ended: end.toISOString(),
          trackId: obj[fid].id
        };

        // console.log(item);
        bulk.push(item);
      });
    });

    ListenEntryModel.bulkCreate(bulk).then(() => {
      console.log('done');
    });
  });
}

async function test() {
  const track = await TrackModel.findOne({
    include: ListenEntryModel
  });
  
  console.log(track?.toJSON());
}

async function testQuery() {
  // const query = `
  //   SELECT t.title, r.totalHours, totalEntries, (r.totalHours / (t.length / 3600.0)) as totalPlays
  //   FROM
  //   (
  //     SELECT DISTINCT le.trackId
  //       , SUM(CAST(DATEDIFF(ms, le.started, le.ended) as BIGINT)) OVER (PARTITION BY le.trackId) / 3600000.0 as totalHours
  //       , COUNT(le.trackId) OVER (PARTITION BY le.trackId) as totalEntries
  //     FROM aria.dbo.ListenEntries AS le
  //   ) as r FULL JOIN aria.dbo.Tracks AS t
  //     ON (t.id = r.trackId)
  //   WHERE t.id = 2
  //   ORDER BY totalHours DESC
  //   ;
  // `;

  // const queryResults = await sequelize.query(query, { type: QueryTypes.SELECT });
  // console.log(queryResults);

  
  const playlists = (await PlaylistModel.findAll({
    include: {
      model: TrackModel,
      attributes: ['id']
    }
  }));

  const lengths = await sequelize.query(`
    SELECT distinct p.id, SUM(t.length) over (partition by p.id) as totalLength
    FROM (
      aria.dbo.playlistJoinTrack as j
        INNER JOIN aria.dbo.playlists as p
          ON p.id = j.[playlistId]
        INNER JOIN aria.dbo.tracks as t
          ON t.id = j.[trackId]
      )
  `, { type: QueryTypes.SELECT }) as any[];

  const json = playlists.map(p => p.toJSON()).map((p) => {
    const f = lengths.find(l => l.id === p.id)!;
    return {
      ...p,
      ...f
    };
  });

  console.log(json);
}

async function pictures() {
const formats = [ ".mp3", ".m4a", ".wav", ".flac" ];

  const libPaths = db.get('0.libraryPaths', { table: tables.settings }) as string[];
  let files: { filepath: string, stat: fs.Dirent }[] = [];
  libPaths.forEach((path) => {
    files.push(...filesFromDirectoryRS(path));
  });

  files = files.filter(f => formats.includes(path.extname(f.filepath)));
  
  const fidsToFind = {} as Record<string, bigint>;
  files.forEach((file) => fidsToFind[file.filepath] = (bigintStatSync(file.filepath).ino));
  
  const foundFids = (await TrackModel.findAll({
    where: {
      fid: {
        [Op.or]: Array.from(Object.values(fidsToFind))
      }
    },
    attributes: ['fid', 'id']
  })).map(t => t.toJSON());

  makeUserDataPath();
  const imgPath = path.join(getUserDataPath(), 'images');

  try { fs.unlinkSync(imgPath); } catch (e) {}
  try { fs.mkdirSync(imgPath); } catch (e) {}
  
  for (let i = 0; i < files.length; i++) {
    const id = foundFids.find(f => f.fid.toString() === fidsToFind[files[i].filepath].toString()).id;
    if (fs.existsSync(path.join(imgPath, `${id}.thumb.png`))) {
      continue;
    }

    const metadata = await mm.parseFile(files[i].filepath);
  
    if (metadata.common.picture && metadata.common.picture[0])
    {
      let format = metadata.common.picture[0].format;
      format = format.substr(format.indexOf("/") + 1);

      const src = path.join(imgPath, `${id}.${format}`);
      fs.writeFileSync(src, metadata.common.picture[0].data);
    }
  }

  const python = spawnSync('python', [path.join(__dirname, '../src/lib/resizeImages.py')], {
    cwd: path.join(__dirname, '../src')
  });

  console.log(python.output);
}

async function playlists() {
  const map = {
    "Glass": "Glass - Remain[fSl]Rust (,,Fade Away'')",
    "Lacuna III OST": "EFFIGY OF DOG ~ DEAD AS TOWERS",
    "Have You Ever Heard of a Talking Flower": "Have You Ever Heard of a Talking Flower?",
    "France, 2014)": "Бабки (Russia / France, 2014)",
    "現代のコンピュー": "リサフランク420 / 現代のコンピュー",
    "Boss": "Blue-Revolver - Boss",
    "The Cluster-Gem Drill": "The Cluster/Gem Drill",
    "Consolation-Smoky Meets Sardonyx": "Consolation/Smoky Meets Sardonyx",
    "Eye'm In the Spotlight! 「スポットライトはあたいのものね！」": "スポットライトはあたいのものね！",
    "Squid Squad": "Ink or Sink / Squid Squad",
    "Synchronize-Sugilite": "Synchronize/Sugilite",
    "This Is War V- Teemo": "This Is War V: Teemo",
    "hi '2morrow' (◕‿◕ノ)ノ (◕‿◕ノ)ノ": 'hi "2morrow" (◕‿◕ノ)ノ (◕‿◕ノ)ノ',
    "Both Sides of the Law (TOMCAT's Theme)": "Both Sides of the Law",
    "i": "i - Spring",
    "ii": "ii - Summer",
    "iii": "iii - Autumn",
    "iv": "iv - Winter",
    "Single": "Tiimmy Turner",
    "SISTER": "SISTER / NATION",
    "Hills of Cypress": "pay no attention (3/4)",
    "Splattack!": "Splattack! / Squid Squad",
    "Go Hard": "Tender Summertime",
    "01 Dragons Aren't Supposed 2 B Cute Right-": "Dragons Aren't Supposed 2 B Cute Right?",
    "02 Yellow Horse": "Yellow Horse",
    "03 Fun Fun Fun ft. SoGreatAndPowerful": "Fun Fun Fun ft. SoGreatAndPowerful",
    "04 Rarity Fighting a Giant Crab": "Rarity Fighting a Giant Crab",
    "05 Princess Breath": "Princess Breath",
    "06 Other Twilight": "Other Twilight",
    "07 Humans are Terrifying": "Humans are Terrifying",
    "08 Exclusive Royal Canterlot Wedding Playset (2)": "Exclusive Royal Canterlot Wedding Playset (2)",
    "09 Princess Breath Refrain": "Princess Breath Refrain",
    "10 Princess Luna's Glorious Grilled Cheese Sandwiches": "Princess Luna's Glorious Grilled Cheese Sandwiches",
    "11 Blue": "Blue",
    "12 Exclusive Royal Canterlot Wedding Playset": "Exclusive Royal Canterlot Wedding Playset",
    "Breathe [Psychography Experiment 24-04-19 II]": "Breathe [Psychography Experiment 24-04-19 II] - NONE OF THIS IS ABOUT TR**S SHIT",
    "v": "v - Seasons",
    "Black Dresses": "Black Dresses - MAYBE THIS WORLD IS ANOTHER PLANET'S HELL - hellvalleyskytrees Scared 2 Dream mix",
    "VENGEANCE": "VENGEANCE | VENGEANCE feat. JPEGMAFIA, ZillaKami"
  };

  const artistMap = {
    "Childish Gambino": "Gambino",
    "RichaadEB -- Ace Waters": "RichaadEB",
    "GUMI; CIRCRUSH": "Gumi, CIRCRUSH",
    "Eminem; Jamie N Commons": "Eminem",
    "sophie meiers; michael mason": "sophie meiers",

  };

  const ignore = [
    'Nameless, Faceless'
  ];

  const notFound: Record<string, string[]> = {};

  const ppath = 'C:\\oneplus\\ppp';

  const files = filesFromDirectoryR(ppath);

  for (let _i = 0; _i < files.length; _i++) {
    const lines = fs.readFileSync(files[_i], 'utf8').split('\n').filter(l => l).map((line) => {
      let ret = line.substr(line.lastIndexOf('/') + 1);
      ret = ret.substr(0, ret.lastIndexOf('.'));
      return ret.split(' - ');
    });

    const ids: number[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let [artist, title, album] = [line[0], line[2] || line[1], line[1]];

      if (title in map) {
        title = (map as any)[title];
      }

      if (artist in artistMap) {
        artist = (artistMap as any)[artist];
      }

      let track: Model | null = null;
      
      let tracks = await TrackModel.findAll({
        where: {
          title,
          artist: {
            [Op.like]: `%${artist.replace(/[\.&\/\[\]\- '"]/g, '%')}%`
          }
        },
        logging: false
      });

      if (tracks.length === 1 || ignore.includes(title)) {
        track = tracks[0];
      }

      if (!track) {
        tracks = await TrackModel.findAll({
          where: {
            title: {
              [Op.like]: `%${title.replace(/[\.&\/\[\]\- '"]/g, '%')}%`
            }
          },
          logging: false
        });

        if (tracks.length === 1 || ignore.includes(title)) {
          track = tracks[0];
        }
      }

      if (!track) {
        tracks = await TrackModel.findAll({
          where: {
            title: {
              [Op.like]: `%${title.replace(/[\.&\/\[\]\- '"]/g, '%')}%`
            },
            artist: {
              [Op.like]: `%${artist.replace(/[\.&\/\[\]\- '"]/g, '%')}%`
            },
            album: {
              [Op.like]: `%${album.replace(/[\.&\/\[\]\- '"]/g, '%')}%`
            }
          },
          logging: false
        });

        if (tracks.length === 1 || ignore.includes(title)) {
          track = tracks[0];
        }
      }

      if (!track) {
        notFound[title] = line;
      } else {
        ids.push((track as any).id);
      }
    }
    
    const name = path.basename(files[_i], path.extname(files[_i]));

    const playlist = await PlaylistModel.create({
      name
    });

    await (playlist as any).addTracks(ids);

    console.log(`created ${name}`);

    // const playlist = await PlaylistModel.create({
    //   name: json.name
    // });

    // const fidsToFind = json.tracks;

    // const tracks = (await TrackModel.findAll({
    //   where: {
    //     fid: {
    //       [Op.or]: Array.from(fidsToFind)
    //     }
    //   }
    // }));

    // const playlist = await PlaylistModel.create({
    //   name: json.name
    // });

    // await (playlist as any).addTracks(tracks);
  }

  console.log(notFound);
}

const fns = {
  init,
  newListens,
  test,
  pictures,
  testQuery,
  playlists
} as Record<string, Function>;

fns[process.argv[process.argv.length - 1]]();

export interface TopLevel {
  album:         string;
  artist:        string;
  length:        number;
  modified:      number;
  picture:       string;
  plays:         number[];
  title:         string;
  track:         number;
  volume:        number;
  listenEntries: ListenEntry[];
}

export interface ListenEntry {
  startTime: number;
  duration:  number;
  songId?:   string;
}

// Generated by https://quicktype.io

export interface Playlist1 {
  tracks:   string[];
  filename: string;
  version:  number;
  name:     string;
}
