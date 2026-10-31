import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function testDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(readFileSync(new URL('../../server/schema.sql', import.meta.url), 'utf8'));
  function prepare(sql) {
    let parameters = [];
    const statement = {
      bind(...values) { parameters = values; return statement; },
      async first() { return sqlite.prepare(sql).get(...parameters) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...parameters) }; },
      async run() { const result = sqlite.prepare(sql).run(...parameters); return { meta: { changes: Number(result.changes) } }; },
      execute() {
        if (/\bRETURNING\b/i.test(sql) || /^\s*SELECT/i.test(sql)) return { results: sqlite.prepare(sql).all(...parameters), meta: {} };
        const result = sqlite.prepare(sql).run(...parameters);
        return { results: [], meta: { changes: Number(result.changes) } };
      },
    };
    return statement;
  }
  return {
    prepare,
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results = statements.map((statement) => statement.execute()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
    close() { sqlite.close(); },
  };
}
