import { DataTypes, Model, ModelAttributes, Sequelize } from "sequelize";
import { sliceObject } from "./objectUtils";
import { metadataKeys, Track, TrackMetadata, TrackSettings } from "./types";

console.log('ploopy');

require('sequelize').DATE.prototype._stringify = function _stringify(date: any, options: any) {
  return this._applyTimezone(date, options).format('YYYY-MM-DD HH:mm:ss.SSS');
};

export const sequelize = new Sequelize('Aria', 'Aria', process.env.DB_PASSWORD, {
  host: 'localhost',
  dialect: 'mssql',
  port: 63978
});

const trackDef = {
  fid: {
    type: DataTypes.BIGINT,
    allowNull: false,
  },
  title: DataTypes.STRING,
  artist: DataTypes.STRING,
  album: DataTypes.STRING,
  length: DataTypes.FLOAT,
  track: DataTypes.INTEGER,
  modified: DataTypes.BIGINT,
  volume: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 1
  },
  // asTrack: {
  //   type: DataTypes.VIRTUAL,
  //   get(): Track {
  //     const self = (this as any) as TrackImpl;
  //     return {
  //       fid: self.fid,
  //       id: self.id.toString(),
  //       listenEntries: self.listenEntries.map((le) => ({
  //         started: +le.started,
  //         ended: +le.ended 
  //       })),
  //       metadata: self.metadata,
  //       path: self.path,
  //       settings: self.settings
  //     };
  //   }
  // },
  metadata: {
    type: DataTypes.VIRTUAL,
    get(): TrackMetadata {
      const self = this as any as TrackImpl;
      return sliceObject(self, metadataKeys);
    },
    set(m: TrackMetadata) {
      const self = this as any as Model;
      self.setAttributes(sliceObject(m, metadataKeys));
    }
  },
  settings: {
    type: DataTypes.VIRTUAL,
    get(): TrackSettings {
      const self = this as any as TrackImpl;
      return {
        volume: self.volume
      };
    },
    set(m: TrackSettings) {
      const self = this as any as Model;
      self.setAttributes(sliceObject(m, ['volume']));
    }
  }
};

const listenEntryDef = {
  started: {
    type: DataTypes.DATE,
    allowNull: false
  },
  ended: {
    type: DataTypes.DATE,
    allowNull: false
  }
};

const playlistDef = {
  name: {
    type: DataTypes.TEXT,
    allowNull: false,
    defaultValue: 'New Playlist'
  }
};

export type TrackAttr = keyof typeof trackDef;
export type TrackImpl = { [P in TrackAttr]: any } & {
  id: number,
  listenEntries: ListenEntryImpl[]
};

// export class TrackModel extends Model {
//   get metadata() {
//     return sliceObject(this.toJSON(), metadataKeys) as SongMetadata;
//   }

//   get settings() {
//     return sliceObject(this.toJSON(), ['volume']) as SongSettings;
//   }
  
//   get toTrack(): Track {
//     const json = this.toJSON() as TrackImpl;
//     return {
//       fid: json.fid,
//       metadata: this.metadata,
//       settings: this.settings,
//       listenEntries: []
//     } as Track;
//   }
// }

export const TrackModel = sequelize.define('track', trackDef, {
  charset: 'utf8',
  collate: 'utf8_unicode_ci'
});

export type ListenEntryAttr = keyof typeof listenEntryDef;
export type ListenEntryImpl = { [P in ListenEntryAttr]: any };

export const ListenEntryModel = sequelize.define('listenEntry', listenEntryDef, {
  charset: 'utf8',
  collate: 'utf8_unicode_ci'
});

export type PlaylistAttr = keyof typeof playlistDef;
export type PlaylistImpl = { [P in PlaylistAttr]: any };

export const PlaylistModel = sequelize.define('playlist', playlistDef, {
  charset: 'utf8',
  collate: 'utf8_unicode_ci'
});

export const TrackRelListenEntry = TrackModel.hasMany(ListenEntryModel);
export const ListenEntryRelTrack = ListenEntryModel.belongsTo(TrackModel);
export const TrackRelPlaylist = TrackModel.belongsToMany(PlaylistModel, { through: 'playlistJoinTrack' });
export const PlaylistRelTrack = PlaylistModel.belongsToMany(TrackModel, { through: 'playlistJoinTrack' });

export async function initDb() {
  await sequelize.sync({
    force: false
  });
}