import { sliceObject } from "./objectUtils";
import { metadataKeys, Track, TrackMetadata, TrackSettings } from "./types";
import _sql from 'mssql';
import { appendFile, writeFile } from "fs";

export const sql = _sql;

console.log('ploopy');

export async function initDb() {
  await sql.connect({
    port: 1433,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    server: 'localhost',
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000
    },
    options: {
      encrypt: true, // for azure
      trustServerCertificate: true // change to true for local dev / self-signed certs
    }
  });
}

export function escapeSqlString(str: string) {
  return `N'${str.replace(/'/g, "''")}'`;
}

export function escapeValue(value: any) {
  if (typeof(value) === 'string') {
    return escapeSqlString(value);
  }

  return value.toString();
}

export async function query(query: string) {
  appendFile('sql_logs.txt', query + '\n\n', 'utf8', () => {});
  return await sql.query(query);
}

export async function insert(table: string, values: Record<string, any>[]) {
  for (let i = 0; i < Math.ceil(values.length/ 1000); i++) {
    await query(`
      INSERT INTO ${table} (${Object.keys(values[0]).join(',')})
        VALUES ${values.slice(i * 1000, Math.min((i + 1) * 1000, values.length)).map((value: Record<string, any>) => {
          return `(${Object.values(value).map(v => typeof(v) === 'string' ? escapeSqlString(v) : v).join(',')})`
        }).join(',')}
    `);
  }
}