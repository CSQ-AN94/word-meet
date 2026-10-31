import { createServer } from 'node:http';
import { postgresDatabase } from './postgres.js';

export const TEST_API_KEY = 'sb_publishable_local_test_key';

export async function roomServer(t) {
  const db = await postgresDatabase();
  let unavailable = false;
  let activeRequests = 0;
  let resolveDrain;
  const server = createServer(async (incoming, outgoing) => {
    activeRequests++;
    try {
      if (unavailable) {
        outgoing.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Temporary test outage' }));
        return;
      }
      const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Max-Age': '600' };
      if (incoming.method === 'OPTIONS') { outgoing.writeHead(204, headers).end(); return; }
      if (incoming.url !== '/rest/v1/rpc/word_meet' || incoming.method !== 'POST') {
        outgoing.writeHead(404, headers).end(JSON.stringify({ message: '接口不存在' }));
        return;
      }
      if (incoming.headers.apikey !== TEST_API_KEY) {
        outgoing.writeHead(401, headers).end(JSON.stringify({ message: 'Invalid API key' }));
        return;
      }
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString());
      const reply = await db.call(payload.p_request);
      outgoing.writeHead(reply.status, headers).end(JSON.stringify(reply.body));
    } catch (error) { if (!outgoing.destroyed) outgoing.writeHead(500).end(error.message); }
    finally { if (--activeRequests === 0) resolveDrain?.(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    if (activeRequests) await new Promise((resolve) => { resolveDrain = resolve; });
    await db.close();
  });
  return { endpoint: 'http://127.0.0.1:' + server.address().port, apiKey: TEST_API_KEY, setUnavailable: (value) => { unavailable = value; } };
}
