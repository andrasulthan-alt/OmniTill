// Local stand-in for Supabase, for tests only: serves the app, a minimal GoTrue
// (signup / password login / refresh) and forwards /rest/v1 to PostgREST.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { Client } = require(process.env.PG_MODULE || 'pg');
const SECRET = 'test-secret-test-secret-test-secret-1234';
const PORT = +process.env.PORT || 54330, REST = +process.env.REST_PORT || 54331;
const APP = path.resolve(process.env.APP_DIR || path.join(__dirname, '..', 'app'));
const b64 = (b) => Buffer.from(b).toString('base64url');
const sign = (p) => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), pl = b64(JSON.stringify(p));
  return `${h}.${pl}.${crypto.createHmac('sha256', SECRET).update(h + '.' + pl).digest('base64url')}`; };
const db = new Client({ host: '/tmp', port: 54329, user: 'postgres', database: process.env.DB || 'ot' });
const users = new Map(); // email -> {id, pw}
const refresh = new Map();
function session(u) {
  const now = Math.floor(Date.now() / 1000), exp = now + 3600;
  const access_token = sign({ sub: u.id, role: 'authenticated', aud: 'authenticated', email: u.email, exp, iat: now });
  const rt = crypto.randomUUID(); refresh.set(rt, u.email);
  return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: rt,
    user: { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: {}, user_metadata: u.meta || {}, created_at: new Date().toISOString() } };
}
const body = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const json = (code, o) => { res.writeHead(code, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify(o)); };
  try {
    if (url.pathname === '/auth/v1/signup') {
      const b = JSON.parse((await body(req)).toString());
      if (!b.email || !b.password || b.password.length < 8) return json(422, { code: 422, msg: 'Password should be at least 8 characters' });
      if (users.has(b.email)) return json(422, { code: 422, msg: 'User already registered' });
      const u = { id: crypto.randomUUID(), email: b.email, pw: b.password, meta: b.data || {} };
      users.set(b.email, u);
      await db.query('insert into auth.users (id,email,raw_user_meta_data) values ($1,$2,$3)', [u.id, u.email, u.meta]);
      return json(200, session(u));
    }
    if (url.pathname === '/auth/v1/token') {
      const b = JSON.parse((await body(req)).toString());
      let u;
      if (url.searchParams.get('grant_type') === 'refresh_token') u = users.get(refresh.get(b.refresh_token));
      else { u = users.get(b.email); if (u && u.pw !== b.password) u = null; }
      if (!u) return json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return json(200, session(u));
    }
    if (url.pathname === '/auth/v1/user') {
      const t = (req.headers.authorization || '').replace('Bearer ', ''); const pl = JSON.parse(Buffer.from(t.split('.')[1] || 'e30', 'base64url').toString());
      const u = [...users.values()].find((x) => x.id === pl.sub); if (!u) return json(401, { msg: 'bad jwt' });
      return json(200, session(u).user);
    }
    if (url.pathname === '/auth/v1/logout') { res.writeHead(204, cors); return res.end(); }
    if (url.pathname.startsWith('/rest/v1/')) {
      const buf = await body(req);
      const p = http.request({ host: '127.0.0.1', port: REST, path: req.url.replace('/rest/v1', ''), method: req.method, headers: { ...req.headers, host: '127.0.0.1' } }, (r) => {
        res.writeHead(r.statusCode, { ...r.headers, ...cors }); r.pipe(res); });
      p.on('error', (e) => json(502, { message: String(e) })); p.end(buf); return;
    }
    // static
    let f = path.join(APP, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
    if (!f.startsWith(APP) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(APP, 'index.html');
    res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(res);
  } catch (e) { json(500, { message: String(e) }); }
}).listen(PORT, async () => { await db.connect(); console.log('mock up', PORT); });
