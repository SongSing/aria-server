import express from "express";
import { validateArray, validateParams, validateStringArray } from "../lib/validators";
import db, { tables } from '../lib/db';
import { mod, stringifyIds } from "../lib/utils";
import { escapeSqlString, insert, query, sql } from "../lib/dbsql";
import { exec } from "child_process";
import { pathMap } from "../library";
import Model from "../lib/model";
import { PlaylistTrack } from "../models";

const router = express.Router();
export default router;

const Playlist = new Model('playlists');

async function fetchPlaylist(id: number) {
  const playlist = (await query(`
    SELECT TOP(1) a1.id as id, name, trackIds, totalLength FROM
      (
        SELECT p.id as id, STRING_AGG(CONVERT(NVARCHAR(max), j.trackId), ',') as trackIds
          FROM playlists as p
            INNER JOIN joinPlaylistsTracks as j ON p.id = j.playlistId
          GROUP BY p.id
      ) as a1
      INNER JOIN
      (
        SELECT distinct p.id, p.name, SUM(t.length) over (partition by p.id) as totalLength 
        FROM (
          joinPlaylistsTracks as j
          INNER JOIN playlists as p
            ON p.id = j.playlistId
          INNER JOIN tracks as t
            ON t.id = j.trackId
          )
      ) as a2
      ON a1.id = a2.id
      WHERE a1.id = ${id}
  `)).recordset[0];

  return {
    id: playlist.id,
    name: playlist.name,
    tracks: playlist.trackIds ? playlist.trackIds.split(',').map((id: string) => ({ id })) : [],
    totalLength: playlist.totalLength || 0
  };
}

router.get('/', async (req, res, next) => {
  const playlists = (await query(`
    SELECT a3.id as id, a3.name, trackIds, totalLength FROM
      (
        SELECT p.id as id, STRING_AGG(CONVERT(NVARCHAR(max), j.trackId), ',') as trackIds
          FROM playlists as p
            INNER JOIN joinPlaylistsTracks as j ON p.id = j.playlistId
          GROUP BY p.id
      ) as a1
      INNER JOIN
      (
        SELECT distinct p.id, p.name, SUM(t.length) over (partition by p.id) as totalLength 
        FROM (
          joinPlaylistsTracks as j
          INNER JOIN playlists as p
            ON p.id = j.playlistId
          INNER JOIN tracks as t
            ON t.id = j.trackId
          )
      ) as a2
      ON a1.id = a2.id
    FULL OUTER JOIN
    (
    SELECT id, name from playlists
    ) as a3
    ON a1.id = a3.id
  `)).recordset;

  const json = playlists.map((playlist) => {
    return {
      id: playlist.id,
      name: playlist.name,
      tracks: playlist.trackIds ? playlist.trackIds.split(',').map((id: string) => ({ id })) : [],
      totalLength: playlist.totalLength || 0
    };
  });

  res.status(200).json(stringifyIds(json));
});

router.post('/', async (req, res, next) => {
  try {
    const playlist = await Playlist.create();
    res.status(201).json(stringifyIds({ ...playlist.attrs, tracks: [] }));
  } catch (e) {
    res.sendStatus(500);
    console.error(e);
  }
});

router.get('/:id', async (req, res, next) => {
  const params = validateParams(req.params, {
    'id': 'int'
  });

  if (!params) {
    res.sendStatus(400);
    return;
  }
  
  const playlist = await fetchPlaylist(params.id);

  if (!playlist) {
    res.sendStatus(400);
    return;
  }

  res.status(200).json(stringifyIds(playlist));
});

router.patch('/:id', async (req, res, next) => {
  const params = validateParams(req.params, {
    'id': 'int'
  });

  const bodyParams = validateParams(req.body, {
    'name': 'string',
  });

  if (!params || !bodyParams) {
    res.sendStatus(400);
    return;
  }

  try {
    let playlist = await Playlist.find(params.id)
  
    if (!playlist) {
      res.sendStatus(400);
      return;
    }

    await playlist.update({ name: bodyParams.name });

    res.status(200).json(stringifyIds(playlist.attrs));
  } catch (e) {
    res.sendStatus(500);
    console.error(e);
  }
});

router.delete('/:id', async (req, res, next) => {
  const params = validateParams(req.params, {
    'id': 'int'
  });

  if (!params) {
    res.sendStatus(400);
    return;
  }
  
  const playlist = await Playlist.find(params.id);

  if (!playlist) {
    res.sendStatus(400);
    return;
  }

  try {
    await playlist.deleteCascade({ model: PlaylistTrack, key: 'playlistId' });
  
    res.sendStatus(204);
  } catch (e) {
    res.sendStatus(500);
    console.error(e);
  }
});

router.post('/:id/videos', async (req, res, next) => {
  // ffmpeg -loop 1 -i <image> -i <audio> -filter:a "volume=1" -c:v libx264 -tune stillimage -c:a aac -b:a 192k -pix_fmt yuv420p -vf scale=w=1920:h=1080:force_original_aspect_ratio=decrease -shortest <out>
  
  const params = validateParams(req.params, {
    'id': 'int'
  });

  if (!params) {
    res.sendStatus(400);
    return;
  }
  
  const playlist = await fetchPlaylist(params.id);

  if (!playlist) {
    res.sendStatus(400);
    return;
  }

  playlist.tracks.forEach(async ({ id }: { id: number }) => {
    const track = (await query(`SELECT id, fid, volume FROM tracks WHERE id = ${id}`)).recordset[0];
    const path = pathMap.get(track.fid)!;

    console.log(`ffmpeg -loop 1 -i "D:\\Git\\aria-server\\data\\images\\${track.id}.full.png" -i "${path}" -filter:a "volume=${track.volume}" -c:v libx264 -tune stillimage -c:a aac -b:a 192k -pix_fmt yuv420p -vf scale=w=1920:h=1080:force_original_aspect_ratio=decrease -shortest "${path}.mp4"`);
  });
});

router.post('/:id/tracks', async (req, res, next) => {
  const params = validateParams(req.params, {
    'id': 'int'
  });

  const bodyParams = validateParams(req.body, {
    'tracks': validateArray('int')
  });

  if (!params || !bodyParams) {
    res.sendStatus(400);
    return;
  }

  try {
    let playlist = (await query(`SELECT TOP(1) * FROM playlists WHERE id = ${params.id}`)).recordset[0];
  
    if (!playlist) {
      res.sendStatus(400);
      return;
    }

    insert('joinPlaylistsTracks', bodyParams.tracks.map((trackId: number) => {
      return {
        playlistId: params.id,
        trackId: trackId
      };
    }));

    res.status(200).json(await fetchPlaylist(params.id));
  } catch (e) {
    res.sendStatus(500);
    console.error(e);
  }
});

router.delete('/:id/tracks/:trackIds', async (req, res, next) => {
  const params = validateParams(req.params, {
    'id': 'int',
    'trackIds': validateStringArray(',', 'int')
  });

  if (!params) {
    res.sendStatus(400);
    return;
  }
  
  try {
    let playlist = (await query(`SELECT TOP(1) * FROM playlists WHERE id = ${params.id}`)).recordset[0];
  
    if (!playlist) {
      res.sendStatus(400);
      return;
    }
    
    for (let i = 0; i < Math.ceil(params.trackIds.length / 1000); i++) {
      await query(`
        DELETE joinPlaylistsTracks
          WHERE ${params.trackIds.slice(i * 1000, Math.min((i + 1) * 1000, params.trackIds.length)).map((trackId: number) => {
            return `(playlistId = ${params.id} AND trackId = ${trackId})`
          }).join(' OR ')}
      `);
    }

    res.status(200).json(await fetchPlaylist(params.id));
  } catch (e) {
    res.sendStatus(500);
    console.error(e);
  }
});

router.post('/:id/tracks/:trackId/moveUp', async (req, res, next) => {
  const params = validateParams(req.params, {
    'id': 'int',
    'trackId': 'int'
  });

  if (!params) {
    res.sendStatus(400);
    return;
  }

  try {
    const joinRecords = (await query(`SELECT * FROM joinPlaylistsTracks WHERE playlistId = ${params.id}`)).recordset;
  
    if (!joinRecords) {
      res.sendStatus(400);
      return;
    }
    
    const index = joinRecords.findIndex(r => r.trackId == params.trackId);

    if (index === -1) {
      res.sendStatus(400);
      return;
    }

    const swapIndex = mod(index - 1, joinRecords.length);

    await query(`
      UPDATE TOP(1) joinPlaylistsTracks
        SET trackId = ${joinRecords[index].trackId}
        WHERE id = ${joinRecords[swapIndex].id}
      ;
    
      UPDATE TOP(1) joinPlaylistsTracks
        SET trackId = ${joinRecords[swapIndex].trackId}
        WHERE id = ${joinRecords[index].id}
      ;
    `);

    res.status(200).json(await fetchPlaylist(params.id));
  } catch (e) {
    res.sendStatus(500);
    console.error(e);
  }
});

router.post('/:id/tracks/:trackId/moveDown', async (req, res, next) => {
  const params = validateParams(req.params, {
    'id': 'int',
    'trackId': 'int'
  });

  if (!params) {
    res.sendStatus(400);
    return;
  }

  try {
    const joinRecords = (await query(`SELECT * FROM joinPlaylistsTracks WHERE playlistId = ${params.id}`)).recordset;
  
    if (!joinRecords) {
      res.sendStatus(400);
      return;
    }
    
    const index = joinRecords.findIndex(r => r.trackId == params.trackId);

    if (index === -1) {
      res.sendStatus(400);
      return;
    }

    const swapIndex = mod(index + 1, joinRecords.length);

    await query(`
      UPDATE TOP(1) joinPlaylistsTracks
        SET trackId = ${joinRecords[index].trackId}
        WHERE id = ${joinRecords[swapIndex].id}
      ;
    
      UPDATE TOP(1) joinPlaylistsTracks
        SET trackId = ${joinRecords[swapIndex].trackId}
        WHERE id = ${joinRecords[index].id}
      ;
    `);

    res.status(200).json(await fetchPlaylist(params.id));
  } catch (e) {
    res.sendStatus(500);
    console.error(e);
  }
});