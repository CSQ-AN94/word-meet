import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

export async function postgresDatabase() {
  const pg = new PGlite();
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  let schema = '';
  try { schema = await readFile(new URL('../../supabase/setup.sql', import.meta.url), 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (schema) await pg.exec(schema);
  return {
    pg,
    async call(payload) {
      try {
        const result = await pg.transaction(async (tx) => {
          await tx.exec('SET LOCAL ROLE anon');
          return tx.query('SELECT public.word_meet($1::jsonb) AS data', [JSON.stringify(payload)]);
        });
        return { status: 200, body: result.rows[0].data };
      } catch (error) {
        const status = /^PT\d{3}$/.test(error.code) ? Number(error.code.slice(2)) : error.code === '42883' ? 404 : error.code === '42501' ? 403 : 500;
        return { status, body: { code: error.code, message: error.message, details: error.detail || null } };
      }
    },
    close: () => pg.close(),
  };
}
