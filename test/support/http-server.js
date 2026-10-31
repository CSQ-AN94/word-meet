import { createServer } from 'node:http';
import { handleRequest } from '../../server/api.js';
import { testDatabase } from './d1.js';

export async function roomServer(t) {
  const db = testDatabase();
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
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const request = new Request('http://127.0.0.1' + incoming.url, {
        method: incoming.method,
        headers: incoming.headers,
        body: ['GET', 'HEAD'].includes(incoming.method) ? undefined : Buffer.concat(chunks),
      });
      const response = await handleRequest(request, db);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) { if (!outgoing.destroyed) outgoing.writeHead(500).end(error.message); }
    finally { if (--activeRequests === 0) resolveDrain?.(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    if (activeRequests) await new Promise((resolve) => { resolveDrain = resolve; });
    db.close();
  });
  return { endpoint: 'http://127.0.0.1:' + server.address().port + '/api', setUnavailable: (value) => { unavailable = value; } };
}
