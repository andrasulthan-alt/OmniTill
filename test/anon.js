// Prints a signed "anon" JWT for the local test stand-in (secret matches test/mock-supabase.js and test/postgrest.conf).
const c = require('crypto'); const b = (x) => Buffer.from(JSON.stringify(x)).toString('base64url');
const h = b({ alg: 'HS256', typ: 'JWT' }), p = b({ role: 'anon', iss: 'supabase', exp: 4102444800 });
console.log(h + '.' + p + '.' + c.createHmac('sha256', 'test-secret-test-secret-test-secret-1234').update(h + '.' + p).digest('base64url'));
