import http from 'http';
import express, { json } from 'express';
import morgan from 'morgan';
import path from 'path';
import cors from 'cors';

import settingsRouter from './routes/settings';
import tracksRouter from './routes/tracks';
import playlistsRouter from './routes/playlists';
import { createThumbnails, initLibrary, loadTracks } from './library';
import db, { tables } from './lib/db';
import { filesFromDirectoryRS } from './lib/utils';
import { Dirent } from 'fs';
import * as fs from 'fs';
import { initDb } from './lib/dbsql';
import { spawnSync } from 'child_process';
import { ListenEntries, Playlist, PlaylistTrack, Track } from './models';

Promise.all([
  initDb()
]).then(init);

async function init() {
  await initLibrary();

  const app = express();
  const port = 9005;

  app.set('port', port);
  app.use(morgan('dev'));
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cors());
  app.use((req, res, next) => {
    res.setHeader('Feature-Policy', "autoplay '*'");
    next();
  });

  // app.use((req, res, next) => {

  // });

  app.use('/settings', settingsRouter);
  app.use('/tracks', tracksRouter);
  app.use('/playlists', playlistsRouter);
  app.use('/data', express.static(path.join(__dirname, '../data')));

  app.get('/', (req, res) =>
  {
    res.send('hi');
  });

  app.post('/refresh', async (req, res) => {
    await initLibrary();
  });

  app.post('/createThumbnails', async (req, res) => {
    createThumbnails();
  });

  app.post('/createTransferFile', async (req, res) => {
    const output = {
      tracks: [],
      listenEntries: [],
      playlists: [],
      playlistTracks: []
    } as any;

    await Track.forEach((record) => {
      const { title, artist, album, track, volume, modified } = record.attrs;

      output.tracks.push({
        id: record.attrs.id,
        uid: {
          title,
          artist,
          album,
          track
        },
        metadata: {
          volume,
          modified
        }
      });
    });

    await ListenEntries.forEach((record) => {
      output.listenEntries.push(record.attrs);
    });

    await Playlist.forEach((record) => {
      output.playlists.push(record.attrs);
    });

    await PlaylistTrack.forEach((record) => {
      output.playlistTracks.push(record.attrs);
    });

    fs.writeFile('transfer.json', JSON.stringify(output), 'utf8', () => {
      res.status(200).send({});
    });
  });

  app.post('readFromTransferFile', async (req, res) => {
    fs.readFile('transfer.json', 'utf8', (err, jsonString) => {
      const json = JSON.parse(jsonString) as {
        tracks: {
          id: string,
          uid: {
            title: string,
            artist: string,
            album: string,
            track: string
          },
          metadata: {
            volume: number,
            modified: string
          }
        }[],
        listenEntries: {
          trackId: string,
          started: string,
          ended: string
        }[],
        playlists: {
          id: string,
          name: string
        }[],
        playlistTracks: {
          id: string,
          playlistId: string,
          trackId: string
        }[]
      };

      const trackIdTranslations = {} as any;
      const playlistIdTranslations = {} as any;

      json.tracks.forEach(async (track) => {
        const record = await Track.query.where(track.uid).record();
        record?.update(track.metadata);
        trackIdTranslations[track.id] = record?.attrs.id;
      });

      json.listenEntries.forEach(async (listenEntry) => {
        await ListenEntries.create({
          ...listenEntry,
          trackId: trackIdTranslations[listenEntry.trackId]
        });
      });

      json.playlists.forEach(async (playlist) => {
        const record = await Playlist.create({ name: playlist.name });
        playlistIdTranslations[playlist.id] = record.attrs.id;
      });

      json.playlistTracks.forEach(async (playlistTrack) => {
        await PlaylistTrack.create({
          playlistId: playlistIdTranslations[playlistTrack.playlistId],
          trackId: trackIdTranslations[playlistTrack.trackId]
        })
      });
    });
  });

  const server = http.createServer(app);
  server.listen(port, async () =>
  {
    console.log(`server started on port ${port} n___n`);
  });

  server.on('error', (error: any) =>
  {
    if (error.syscall !== 'listen')
    {
      throw error;
    }
    
    var bind = typeof port === 'string'
    ? 'Pipe ' + port
    : 'Port ' + port;
    
    // handle specific listen errors with friendly messages
    switch (error.code)
    {
      case 'EACCES':
        console.error(bind + ' requires elevated privileges');
        process.exit(1);
        break;
      case 'EADDRINUSE':
        console.error(bind + ' is already in use');
        process.exit(1);
        break;
      default:
        throw error;
    }
  });
}