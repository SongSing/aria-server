import express from "express";
import { validateArray, validateInt, validateParams } from "../lib/validators";
import { ListenEntry, metadataKeys, TrackMetadata, TrackSettings } from "../lib/types";
import { sliceObject } from "../lib/objectUtils";
import { pathMap } from "../library";
import { stringifyId, stringifyIds } from "../lib/utils";
import { query, sql } from "../lib/dbsql";
import * as fs from "fs";
import Model from "../lib/model";
import { ListenEntries, Track } from "../models";

const router = express.Router();

function formatTracks(tracks: any[]):  Record<string, Pick<any, 'id' | 'metadata' | 'settings'>> {
  const ret = {} as Record<string, Pick<any, 'id' | 'metadata' | 'settings'>>;

  tracks.forEach((track, i) => {
    let data = {
      id: track.id.toString(),
      metadata: sliceObject(track, metadataKeys),
      settings: sliceObject(track, ['volume'])
      // listenEntries: (track.listenEntries as ListenEntryImpl[]).map((le) => ({
      //   started: +new Date(le.started),
      //   ended: +new Date(le.ended)
      // }))
    };

    ret[track.id.toString()] = data;
  });

  return stringifyIds(ret);
}

router.get('/', async (req, res, next) => {
  const all = await Track.all_attrs();

  res.status(200).json({
    tracks: formatTracks(all)
  });
});

router.get('/:trackId/file', async (req, res, next) => {
  const params = validateParams(req.params, {
    'trackId': 'int'
  });

  if (!params) {
    res.sendStatus(400);
    return;
  }
  
  const track = await Track.find(params.trackId);

  if (!track) {
    res.sendStatus(400);
    return;
  }

  res.status(200).sendFile(pathMap.get(track.attrs.fid)!, (err) => {
    if (err) {
      console.error(err);
    }
  })
});

router.patch('/:trackId/settings', async (req, res, next) => {
  const params = validateParams(req.params, {
    'trackId': 'int'
  });

  const bodyParams = validateParams<keyof TrackSettings>(req.body, {
    volume: 'float'
  });

  if (!params || !bodyParams) {
    res.sendStatus(400);
    return;
  }

  try {
    await Track.update(params.trackId, bodyParams);
    res.sendStatus(200);
  } catch (e) {
    res.sendStatus(500);
  }
});

router.get('/stats', async (req, res, nextf) => {
  const totalHoursQuery = `
    SELECT SUM(CAST(DATEDIFF(ms, le.started, le.ended) as BIGINT)) / 3600000.0 as totalHours
      FROM aria.dbo.listenEntries as le
  `;

  const { totalHours } = (await query(totalHoursQuery)).recordset[0];

  const recentQuery = `
    SELECT TOP 10 t.id, r.totalHours, totalEntries, (r.totalHours / (t.length / 3600.0)) as totalPlays
    FROM
    (
      SELECT DISTINCT le.trackId
      ,SUM(CAST(DATEDIFF(ms, le.started, le.ended) as BIGINT)) OVER (PARTITION BY le.trackId) / 3600000.0 as totalHours
      ,COUNT(le.trackId) OVER (PARTITION BY le.trackId) as totalEntries
      FROM aria.dbo.ListenEntries AS le
      WHERE le.started >= DATEADD(day, -7, GETDATE())
    ) as r FULL JOIN aria.dbo.Tracks AS t
      ON (t.id = r.trackId)
    WHERE totalEntries IS NOT NULL
    ORDER BY totalPlays DESC
    ;
  `;

  const recent = (await query(recentQuery)).recordset;

  const allTimeQuery = `
    SELECT TOP 30 t.id, r.totalHours, totalEntries, (r.totalHours / (t.length / 3600.0)) as totalPlays
    FROM
    (
      SELECT DISTINCT le.trackId
      ,SUM(CAST(DATEDIFF(ms, le.started, le.ended) as BIGINT)) OVER (PARTITION BY le.trackId) / 3600000.0 as totalHours
      ,COUNT(le.trackId) OVER (PARTITION BY le.trackId) as totalEntries
      FROM aria.dbo.ListenEntries AS le
    ) as r FULL JOIN aria.dbo.Tracks AS t
      ON (t.id = r.trackId)
    WHERE totalEntries IS NOT NULL
    ORDER BY totalPlays DESC, totalHours DESC
    ;
  `;

  const allTime = (await query(allTimeQuery)).recordset;

  res.status(200).json({
    totalHours,
    recent: recent.map(stringifyId),
    allTime: allTime.map(stringifyId),
  });
});

router.get('/:trackId/playCount', async (req, res, next) => {
  const params = validateParams(req.params, {
    'trackId': 'int'
  });

  if (!params) {
    res.sendStatus(400);
    return;
  }

  const q = `
    SELECT r.totalHours, totalEntries, (r.totalHours / (t.length / 3600.0)) as totalPlays
    FROM
    (
      SELECT DISTINCT le.trackId
        , SUM(CAST(DATEDIFF(ms, le.started, le.ended) as BIGINT)) OVER (PARTITION BY le.trackId) / 3600000.0 as totalHours
        , COUNT(le.trackId) OVER (PARTITION BY le.trackId) as totalEntries
      FROM aria.dbo.ListenEntries AS le
    ) as r FULL JOIN aria.dbo.Tracks AS t
      ON (t.id = r.trackId)
    WHERE t.id = ${params.trackId}
    ORDER BY totalHours DESC
    ;
  `;

  const queryResults = (await query(q)).recordset;

  if (queryResults.length > 0) {
    const result = queryResults[0] as Record<string, any>;

    for (const key in result) {
      if (result.hasOwnProperty(key) && result[key] === null) {
        result[key] = 0;
      }
    }

    res.status(200).json(result);
  } else {
    res.sendStatus(500);
  }
});

router.get('/:trackId/listenEntries', async (req, res, next) => {
  const params = validateParams(req.params, {
    'trackId': 'int'
  });

  if (!params) {
    res.sendStatus(400);
    return;
  }

  try {
    const listenEntries = (await query(`
      SELECT *
        FROM listenEntries
        WHERE trackId = ${params.trackId}
        ORDER BY started ASC
    `)).recordset.map((le) => ({
      ...le,
      started: +le.started,
      ended: +le.ended
    }));

    res.status(200).json({ listenEntries: stringifyIds(listenEntries) });
  } catch(e) {
    console.error(e);
    res.sendStatus(500);
  }
});

router.post('/consolidateModified', async (req, res, next) => {
  const bodyParams = validateParams(req.body, {
    trackIds: validateArray('int')
  });

  if (!bodyParams || bodyParams.trackIds.length < 1) {
    res.sendStatus(400);
    return;
  }

  const whereClause = bodyParams.trackIds.map((trackId: number) => {
    return `id = ${trackId}`
  }).join(' OR ');

  const tracks = (await query(`
    SELECT id, fid, modified FROM tracks
    WHERE ${whereClause}
  `)).recordset;

  const newTime = new Date(parseInt(tracks[0].modified));
  
  tracks.forEach(({ id, fid, modified }: { id: string, fid: string, modified: string }, i: number) => {
    const path = pathMap.get(fid);

    if (path) {
      const currentTimes = fs.statSync(path);
      fs.utimesSync(path, currentTimes.atime, newTime);
    }
  });

  const newTracks = (await query(`
    UPDATE tracks
      SET modified = ${+newTime}
      OUTPUT inserted.*
      WHERE ${whereClause}
  `)).recordset;
  
  res.status(200).json({ tracks: formatTracks(newTracks) });
});

router.post('/makeMostRecent', async (req, res, next) => {
  const bodyParams = validateParams(req.body, {
    trackIds: validateArray('int')
  });

  if (!bodyParams || bodyParams.trackIds.length < 1) {
    res.sendStatus(400);
    return;
  }

  const whereClause = bodyParams.trackIds.map((trackId: number) => {
    return `id = ${trackId}`
  }).join(' OR ');

  const tracks = (
    await Track
      .query
      .select(['id', 'fid', 'modified'])
      .where({ id: bodyParams.trackIds })
      .go()
  );

  const newTime = new Date();
  
  tracks.forEach(({ id, fid, modified }: { id: string, fid: string, modified: string }, i: number) => {
    const path = pathMap.get(fid);

    if (path) {
      const currentTimes = fs.statSync(path);
      fs.utimesSync(path, currentTimes.atime, newTime);
    }
  });

  const newTracks = (await query(`
    UPDATE tracks
      SET modified = ${+newTime}
      OUTPUT inserted.*
      WHERE ${whereClause}
  `)).recordset;
  
  res.status(200).json({ tracks: formatTracks(newTracks) });
});

router.post('/listenEntries', async (req, res, next) => {
  const bodyParams = validateParams(req.body, {
    trackId: 'int',
    started: 'date',
    ended: 'date'
  });

  if (!bodyParams) {
    res.sendStatus(400);
    return;
  }

  const track = (await Track.query.select(['fid']).where({ id: bodyParams.trackId }).go())[0]

  if (!track) {
    res.sendStatus(400);
    return;
  }

  try {
    const existing = (await
      ListenEntries
        .query
        .select(['id'])
        .where({ trackId: bodyParams.trackId, started: bodyParams.started.toISOString() })
        .record()
    );

    if (existing) {
      await existing.update({ ended: bodyParams.ended.toISOString() });
    } else {
      await ListenEntries.create({
        trackId: bodyParams.trackId,
        started: bodyParams.started.toISOString(),
        ended: bodyParams.ended.toISOString()
      });
    }
  
    res.sendStatus(201);
  } catch (e) {
    console.error(e);
    res.sendStatus(500);
  }
});

export default router;