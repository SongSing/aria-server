import http from 'http';
import express, { json } from 'express';
import morgan from 'morgan';
import path from 'path';
import cors from 'cors';

import settingsRouter from './routes/settings';
import tracksRouter from './routes/tracks';
import playlistsRouter from './routes/playlists';
import { loadTracks } from './library';
import db, { tables } from './lib/db';
import { filesFromDirectoryRS } from './lib/utils';
import { Dirent } from 'fs';
import { initDb, sequelize } from './lib/dbsql';

Promise.all([
  sequelize.authenticate(),
  initDb()
]).then(init);

async function init() {
  const libPaths = db.get('0.libraryPaths', { table: tables.settings }) as string[];
  const files: { filepath: string, stat: Dirent }[] = [];
  libPaths.forEach((path) => {
    files.push(...filesFromDirectoryRS(path));
  });
  await loadTracks(files.map(f => f.filepath));

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

  app.use('/settings', settingsRouter);
  app.use('/tracks', tracksRouter);
  app.use('/playlists', playlistsRouter);
  app.use('/data', express.static(path.join(__dirname, '../data')));
  console.log(path.join(__dirname, '../data'));

  app.get('/', (req, res) =>
  {
    res.send('hi');
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