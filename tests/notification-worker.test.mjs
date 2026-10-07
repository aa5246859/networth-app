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

test('failed strategy notifications can retry; successful devices deduplicate per strategy version',async(t)=>{
  const {generateKeyPairSync}=await import('node:crypto');
  const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
  let version='v2',fcmAttempts=0,fail=true;const events=new Set(),pushUrls=[];
  const doc=fields=>({fields});
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const path=String(url);
    if(path.includes('accounts:lookup'))return Response.json({users:[{localId:'author',email:'aaz52468599@gmail.com',emailVerified:true}]});
    if(path.includes('/strategies/'))return Response.json(doc({ownerUid:{stringValue:'author'},id:{stringValue:'p1'},published:{booleanValue:true},updatedAt:{stringValue:version},title:{stringValue:'Test'},symbol:{stringValue:'BTC'},term:{stringValue:'short'}}));
    if(path.includes('/strategyAccess/'))return Response.json(doc({viewerUids:{arrayValue:{values:[{stringValue:'member'}]}}}));
    if(path.includes('/access/'))return Response.json(doc({status:{stringValue:'approved'}}));
    if(path.includes('oauth2.googleapis.com'))return Response.json({access_token:'test-service-token'});
    if(path.includes('messages:send')){pushUrls.push(JSON.parse(options.body).message.data.url);fcmAttempts++;return fail?Response.json({error:{status:'PERMISSION_DENIED'}},{status:403}):Response.json({name:'accepted'});}
    throw new Error('Unexpected request '+path);
  });
  const DB={prepare(sql){let args;return {bind(...values){args=values;assert.ok(values.every(v=>v!==undefined));return this},async all(){return {results:[{uid:'member',device_id:'phone',email:'member@example.com',token:'test-device-token'}]}},async first(){return events.has(args[0])?{event_key:args[0]}:null},async run(){if(sql.startsWith('INSERT'))events.add(args[0]);return {meta:{changes:1}}}}}};
  const testEnv={...env,DB,FIREBASE_API_KEY:'test-key',FIREBASE_PROJECT_ID:'test-project',FCM_SERVICE_ACCOUNT:JSON.stringify({client_email:'test@example.com',private_key:privateKey})};
  const request=()=>new Request('https://worker.example/strategy-event',{method:'POST',headers:{Origin:env.APP_ORIGIN,Authorization:'Bearer test-author-token','Content-Type':'application/json'},body:JSON.stringify({postId:'p1'})});
  const failed=await (await worker.fetch(request(),testEnv)).json();assert.equal(failed.failed,1);assert.equal(failed.sent,0);assert.equal(events.size,0);
  fail=false;
  const retry=await (await worker.fetch(request(),testEnv)).json();assert.equal(retry.sent,1);assert.equal(retry.failed,0);assert.equal(events.size,1);
  const repeat=await (await worker.fetch(request(),testEnv)).json();assert.equal(repeat.duplicate,1);assert.equal(fcmAttempts,2);
  version='v3';const edited=await (await worker.fetch(request(),testEnv)).json();assert.equal(edited.sent,1);assert.equal(fcmAttempts,3);assert.ok(pushUrls.every(url=>url==='./#sharing?owner=author&post=p1&term=short'));
});
