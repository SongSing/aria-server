import express from "express";
import { validateArray, validateParams } from "../lib/validators";
import db, { tables } from '../lib/db';

const router = express.Router();

type Settings = {
  libraryPaths: string[];
};

const defaultSettings: Settings = {
    libraryPaths: []
};

router.get('/', (req, res, next) => {
  res.status(200).json(db.get('0', { table: tables.settings }) || defaultSettings);
});

// router.patch('/', (req, res, next) => {
//   const bodyParams = validateParams(req.body, {
//     "libraryPaths": validateArray('string')
//   });

//   if (!bodyParams) {
//     res.sendStatus(400);
//     return;
//   }
  
// });

// GET /settings/libraryPaths
// Returns all library paths
router.get('/libraryPaths', (req, res, next) => {
  res.status(200).json({
    libraryPaths: db.get('0.libraryPaths', { table: tables.settings }) || defaultSettings.libraryPaths
  });
});

// POST /settings/libraryPaths
// Adds a library path
router.post('/libraryPaths', (req, res, next) => {
  const bodyParams = validateParams(req.body, {
    'path': 'string'
  });

  if (!bodyParams) {
    res.sendStatus(400);
    return;
  }

  db.push('0.libraryPaths', bodyParams.path, { table: tables.settings });

  res.status(201).json({ libraryPaths: db.get('0.libraryPaths', { table: tables.settings }) })
});

router.delete('/libraryPaths/:id', (req, res, next) => {
  const params = validateParams(req.params, {
    'id': 'int'
  });

  if (!params) {
    res.sendStatus(400);
    return;
  }

  let arr = db.get('0.libraryPaths', { table: tables.settings });
  arr.splice(params.id, 1);
  db.set('0.libraryPaths', arr, { table: tables.settings });
  res.status(200).json({ libraryPaths: arr });
});

router.patch('/libraryPaths/:id', (req, res, next) => {
  const params = validateParams(req.params, {
    'id': 'int'
  });

  const bodyParams = validateParams(req.body, {
    'path': 'string'
  });

  if (!params || !bodyParams) {
    res.sendStatus(400);
    return;
  }

  let arr = db.get('0.libraryPaths', { table: tables.settings });
  arr[params.id] = bodyParams.path;
  db.set('0.libraryPaths', arr, { table: tables.settings });
  res.status(200).json({ libraryPaths: arr });
});

export default router;