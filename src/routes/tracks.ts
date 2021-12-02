import express from "express";
import { validateArray, validateInt, validateParams } from "../lib/validators";
import { ListenEntry, metadataKeys, Track, TrackMetadata, TrackSettings } from "../lib/types";
import { ListenEntryImpl, ListenEntryModel, sequelize, TrackImpl, TrackModel } from "../lib/dbsql";
import { sliceObject } from "../lib/objectUtils";
import { Model, Op, QueryTypes } from "sequelize/dist";
import { pathMap } from "../library";
import { stringifyId, stringifyIds } from "../lib/utils";

const router = express.Router();

router.get('/', async (req, res, next) => {
  const ret = {} as Record<string, Pick<Track, 'id' | 'metadata' | 'settings'>>;

  const all = await TrackModel.findAll({
    // include: ListenEntryModel
  });

  all.forEach((track, i) => {
    const json = track.toJSON();

    let data = {
      id: json.id.toString(),
      metadata: sliceObject(json, metadataKeys),
      settings: sliceObject(json, ['volume'])
      // listenEntries: (json.listenEntries as ListenEntryImpl[]).map((le) => ({
      //   started: +new Date(le.started),
      //   ended: +new Date(le.ended)
      // }))
    };

    ret[json.id.toString()] = data;
  });

  res.status(200).json({
    tracks: stringifyIds(ret)
  });
});

router.get('/:trackId/file', async (req, res, next) => {
  const params = validateParams(req.params, {
    'trackId': 'int'
  });

  let track: (Model & TrackImpl) | null;

  if (!params|| !(track = (await TrackModel.findByPk(params.trackId)) as any as (Model & TrackImpl))) {
    res.sendStatus(400);
    return;
  }

  res.status(200).sendFile(pathMap.get(track.fid)!, (err) => {
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

  let track: Model | null;

  if (!params || !bodyParams || !(track = await TrackModel.findByPk(params.trackId))) {
    res.sendStatus(400);
    return;
  }

  try {
    await track.update(bodyParams);
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

  const { totalHours } = (await sequelize.query(totalHoursQuery, { type: QueryTypes.SELECT }))[0] as any;

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

  const recent = (await sequelize.query(recentQuery, { type: QueryTypes.SELECT })) as any[];

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

  const allTime = (await sequelize.query(allTimeQuery, { type: QueryTypes.SELECT })) as any[];

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

  const query = `
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

  const queryResults = await sequelize.query(query, { type: QueryTypes.SELECT });

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

router.post('/listenEntries', async (req, res, next) => {
  const bodyParams = validateParams(req.body, {
    trackId: 'int',
    started: 'date',
    ended: 'date'
  });

  let track: (Model & TrackImpl) | null;

  if (!bodyParams || !(track = await TrackModel.findByPk(bodyParams.trackId) as any as (Model & TrackImpl))) {
    res.sendStatus(400);
    return;
  }
  
  try {
    const existing = await ListenEntryModel.findOne({
      where: {
        [Op.and]: {
          trackId: track.id,
          started: bodyParams.started.toISOString()
        }
      }
    });

    if (existing) {
      console.log('poggers');
      await existing.update('ended', bodyParams.ended.toISOString());
    } else {
      await ListenEntryModel.create({
        trackId: bodyParams.trackId,
        started: bodyParams.started.toISOString(),
        ended: bodyParams.ended.toISOString()
      });
    }
  
    res.sendStatus(201);
  } catch (e) {
    res.sendStatus(500);
  }
});

export default router;