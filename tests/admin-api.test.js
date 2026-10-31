import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/admin.js';
const originalFetch = globalThis.fetch;
const originalUrl = process.env.SUPABASE_URL;
const originalKey = process.env.SUPABASE_PUBLISHABLE_KEY;
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-public-key';
after(() => { globalThis.fetch = originalFetch; if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl; if (originalKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = originalKey; });
function response() {
  return { statusCode: 200, headers: {}, body: '', setHeader(k,v) { this.headers[k] = v; return this; }, status(n) { this.statusCode = n; return this; }, end(body) { this.body = body; return this; }, json(body) { this.body = body; return this; } };
}
function mockServer(admin) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify(String(url).includes('/auth/v1/user') ? { id: 'test-user', aud: 'authenticated' } : admin), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return calls;
}
test('direct /admin without session returns 401, no-store and no shell', async () => {
  const res = response(); await handler({ method:'GET', headers:{} }, res);
  assert.equal(res.statusCode,401); assert.match(res.body,/Требуется вход/); assert.doesNotMatch(res.body,/assets\//); assert.equal(res.headers['Cache-Control'],'private, no-store');
});
test('POST rejects cross-site and missing origins before authentication', async () => {
  for (const origin of [undefined,'https://evil.example']) {
    const res = response(); await handler({ method:'POST', headers:{ host:'app.example', origin, authorization:'Bearer test-token' } },res); assert.equal(res.statusCode,403);
  }
});
test('ordinary account is denied by server RPC even after valid Auth lookup',async () => {
  const calls = mockServer(false); const res=response();
  await handler({method:'POST',headers:{host:'app.example',origin:'https://app.example',authorization:'Bearer test-token'}},res);
  assert.equal(res.statusCode,403); assert.equal(calls.length,2); assert.match(calls[1].url,/is_current_user_admin/); assert.match(res.headers['Set-Cookie'],/Max-Age=0/);
});
test('fixed admin gets a bounded HttpOnly Secure cookie after server checks',async () => {
  mockServer(true); const res=response(); await handler({method:'POST',headers:{host:'app.example',origin:'https://app.example',authorization:'Bearer test-token'}},res);
  assert.equal(res.statusCode,204); assert.match(res.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Strict; Max-Age=300/);
});
test('direct admin page checks both Auth and RPC before serving built HTML',async()=>{
  const calls=mockServer(true);const res=response();
  await handler({method:'GET',headers:{cookie:'__Host-admin_access=test-token'}},res);
  assert.equal(res.statusCode,200);assert.equal(calls.length,2);assert.match(res.body,/id="root"/);assert.match(res.body,/\/assets\//);
});
test('a previously issued cookie does not grant access after server revokes admin rights',async()=>{
  mockServer(false);const res=response();
  await handler({method:'GET',headers:{cookie:'__Host-admin_access=previous-admin-token'}},res);
  assert.equal(res.statusCode,403);assert.doesNotMatch(res.body,/id="root"/);
});
test('sign out clears the admin cookie',async()=>{
  const res=response();await handler({method:'DELETE',headers:{host:'app.example',origin:'https://app.example'}},res);
  assert.equal(res.statusCode,204);assert.match(res.headers['Set-Cookie'],/Max-Age=0/);
});
test('forged or expired token cannot reach admin RPC',async () => {
  let calls=0; globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({message:'Invalid JWT',code:'bad_jwt'}),{status:401,headers:{'Content-Type':'application/json'}});};
  const res=response();await handler({method:'GET',headers:{cookie:'__Host-admin_access=forged-token'}},res);assert.equal(res.statusCode,401);assert.equal(calls,1);
});
test('network failures fail closed without returning tokens or raw diagnostics',async()=>{
  globalThis.fetch=async()=>{throw new Error('secret-internal-diagnostic');};const res=response();
  await handler({method:'GET',headers:{cookie:'__Host-admin_access=private-token'}},res);
  assert.equal(res.statusCode,503);assert.doesNotMatch(res.body,/private-token|secret-internal/);
});
test('unsupported methods are rejected',async()=>{const res=response();await handler({method:'PUT',headers:{}},res);assert.equal(res.statusCode,405);});
