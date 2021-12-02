import express from "express";
import { validateArray, validateParams } from "../lib/validators";
import db, { tables } from '../lib/db';
import { PlaylistModel, sequelize, TrackModel } from "../lib/dbsql";
import { stringifyIds } from "../lib/utils";
import { QueryTypes } from "sequelize/dist";

const router = express.Router();

router.get('/', async (req, res, next) => {
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

  res.status(200).json(stringifyIds(json));
});

router.post('/', async (req, res, next) => {
  try {
    const playlist = await PlaylistModel.create();
    const ret = stringifyIds(playlist.toJSON());
    ret.tracks = [];
    res.status(201).json(ret);
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
  
  const playlist = await PlaylistModel.findByPk(params.id, {
    include: {
      model: TrackModel,
      attributes: ['id']
    }
  });

  if (!playlist) {
    res.sendStatus(400);
    return;
  }

  res.status(200).json(stringifyIds(playlist.toJSON()));
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
    const playlist = await PlaylistModel.findByPk(params.id, {
      include: {
        model: TrackModel,
        attributes: ['id']
      }
    });
  
    if (!playlist) {
      res.sendStatus(400);
      return;
    }
  
    await playlist.update({ ...bodyParams });

    res.status(200).json(stringifyIds((await playlist.reload()).toJSON()));
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
  
  const playlist = await PlaylistModel.findByPk(params.id);

  if (!playlist) {
    res.sendStatus(400);
    return;
  }

  try {
    await playlist.destroy();
  
    res.sendStatus(204);
  } catch (e) {
    res.sendStatus(500);
    console.error(e);
  }
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
    const playlist = await PlaylistModel.findByPk(params.id, {
      include: {
        model: TrackModel,
        attributes: ['id']
      }
    });
  
    if (!playlist) {
      res.sendStatus(400);
      return;
    }
    
    await (playlist as any).addTracks(bodyParams.tracks);

    res.status(200).json(stringifyIds((await playlist.reload()).toJSON()));
  } catch (e) {
    res.sendStatus(500);
    console.error(e);
  }
});

router.delete('/:id/tracks', async (req, res, next) => {
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
    const playlist = await PlaylistModel.findByPk(params.id, {
      include: {
        model: TrackModel,
        attributes: ['id']
      }
    });
  
    if (!playlist) {
      res.sendStatus(400);
      return;
    }
    
    await (playlist as any).removeTracks(bodyParams.tracks);

    res.status(200).json(stringifyIds((await playlist.reload()).toJSON()));
  } catch (e) {
    res.sendStatus(500);
    console.error(e);
  }
});

export default router;