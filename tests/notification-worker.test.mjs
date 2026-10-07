import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../notification-worker/worker.js';
const env={APP_ORIGIN:'https://wealth.example'};
test('notification Worker only accepts requests from the configured App origin',async()=>{
  const response=await worker.fetch(new Request('https://worker.example/register',{method:'POST',headers:{Origin:'https://attacker.example'}}),env);
  assert.equal(response.status,403);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),env.APP_ORIGIN);
});
test('notification Worker answers CORS preflight without contacting Firebase',async()=>{
  const response=await worker.fetch(new Request('https://worker.example/register',{method:'OPTIONS',headers:{Origin:env.APP_ORIGIN}}),env);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('Access-Control-Allow-Methods'),'POST, OPTIONS');
});
test('notification registration rejects missing Firebase authentication',async()=>{
  const response=await worker.fetch(new Request('https://worker.example/register',{method:'POST',headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json'},body:'{}'}),env);
  assert.equal(response.status,400);
  assert.match((await response.json()).error,/請先登入 App/);
});
test('daily cron skips devices that opened today and records the daily send date',async()=>{
  const statements=[];
  const db={prepare(sql){statements.push(sql);return {bind(){return this},async all(){return {results:[]}},async run(){return {meta:{changes:1}}}}}};
  let pending;const ctx={waitUntil(p){pending=p}};
  await worker.scheduled({}, {DB:db}, ctx);await pending;
  assert.ok(statements.some(sql=>sql.includes('last_opened_day<>?')));
  assert.ok(statements.some(sql=>sql.includes('daily_sent_day<>?')));
});

test('notification registration stores the verified Firebase email and never binds undefined',async(t)=>{
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({users:[{localId:'admin-user',email:'AAZ52468599@gmail.com',emailVerified:true}]}),{status:200}));
  let values;
  const DB={prepare(){return {bind(...args){assert.ok(args.every(value=>value!==undefined));values=args;return this},async run(){return {meta:{changes:1}}}}}};
  const response=await worker.fetch(new Request('https://worker.example/register',{method:'POST',headers:{Origin:env.APP_ORIGIN,Authorization:'Bearer test-id-token','Content-Type':'application/json'},body:JSON.stringify({deviceId:'test-device',token:'test-fcm-token-long-enough',strategy:true,daily:true})}),{...env,DB,FIREBASE_API_KEY:'test-key'});
  assert.equal(response.status,200);
  assert.equal(values[0],'admin-user');
  assert.equal(values[2],'aaz52468599@gmail.com');
  assert.deepEqual(await response.json(),{ok:true});
});
