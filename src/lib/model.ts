import { escapeSqlString, escapeValue, query } from "./dbsql";

export default class Model<T = Record<string, any>> {
  constructor(private tableName: string) {

  }

  forEach(method: (record: ModelRecord) => any, pageSize=1000) {
    return new Promise((resolve, reject) => {
      const tableName = this.tableName;

      function nextPage(i: number) {
        query(`
          SELECT *
            FROM ${tableName}
            ORDER BY id
            OFFSET ${i} ROWS
            FETCH NEXT ${pageSize} ROWS ONLY
        `).then((r) => {
          const result = r.recordset;

          if (result.length === 0) {
            resolve(true);
          }
    
          result.forEach((value) => {
            const record = new ModelRecord(tableName, value);
            method(record);
          });

          nextPage(i + pageSize);
        });
      }

      nextPage(0);
    })
  }

  async find(id: number | string) {
    const q = `SELECT TOP(1) * FROM ${this.tableName} WHERE id = ${id}`;
    const result = (await query(q)).recordset[0] as T;

    return result ? new ModelRecord(this.tableName, result) : null;
  }

  record(id: number | string) {
    return new ModelRecord(this.tableName, { id });
  }

  async update(id: number | string, attrs: T) {
    return await this.record(id).update(attrs);
  }

  async all_attrs() {
    return (await query(`SELECT * FROM ${this.tableName}`)).recordset;
  }

  new(attrs = {}) {
    return new ModelRecord(this.tableName, attrs);
  }

  async create(attrs = {}) {
    return await this.new(attrs).save();
  }

  get query() {
    return new ModelQuery(this.tableName);
  }
}

export class ModelQuery {
  private action: string = 'SELECT * FROM';
  private args: string[] = [];
  private whereStrings: string[] = [];

  constructor(public tableName: string) {

  }

  delete() {
    this.action = `DELETE ${this.tableName}`;
    return this;
  }

  select(attrs: string[] = ['*']) {
    this.action = `SELECT ${attrs.join(', ')} FROM`;
    return this;
  }

  where(attrs: Record<string, any>) {
    const str = Object.entries(attrs).map(([key, values]) => {
      const arr = Array.isArray(values) ? values : [values];
      return `(${arr.map(v => `${key} = ${escapeValue(v)}`).join(' OR ')})`;
    }).join(' AND ');

    this.whereStrings.push(`(${str})`);
    return this;
  }

  toString() {
    return `${this.action} ${this.tableName}\nWHERE ${this.whereStrings.join(' AND ')}`;
  }

  async go() {
    return (await query(this.toString())).recordset;
  }

  async record() {
    const record = (await this.go())[0];
    if (!record) return null;

    return new ModelRecord(this.tableName, record);
  }
}

export class ModelRecord {
  constructor(public tableName: string, public attrs: Record<string, any>) {

  }

  updateAttrs(attrs: Record<string, any>) {
    this.attrs = attrs;
  }

  async delete() {
    return await new Model(this.tableName).query.delete().where({ id: this.attrs.id }).go();
  }

  async deleteCascade(joinModel: { model: Model, key: string }) {
    await joinModel.model.query.delete().where({ [joinModel.key]: this.attrs.id }).go();
    return this.delete();
  }

  async save(attrs = this.attrs) {
    if (Object.prototype.hasOwnProperty.call(this.attrs, 'id')) {
      this.attrs = (await query(`
        UPDATE TOP(1) ${this.tableName}
          SET ${this.setString(attrs)}
          OUTPUT inserted.*
          WHERE id = ${(this.attrs as any).id}
      `)).recordset[0];
    } else {
      this.attrs = (await query(`
        INSERT INTO ${this.tableName} ${Object.keys(attrs).length ? `(${Object.keys(attrs).join(', ')})` : ''}
          OUTPUT inserted.*
          ${this.insertString(attrs)}
      `)).recordset[0];
    }

    return this;
  }

  async update(attrs: Record<string, any>) {
    return await this.save(attrs);
  }

  private setString(attrs = this.attrs): string {
    return Object.entries(attrs).map((a) => `${a[0]} = ${escapeValue(a[1])}`).join(', ');
  }

  private insertString(attrs = this.attrs): string {
    if (Object.keys(attrs).length === 0) {
      return 'DEFAULT VALUES';
    }

    return `VALUES (${Object.entries(attrs).map((a) => `${escapeValue(a[1])}`).join(', ')})`;
  }
}

class Query {
  
}