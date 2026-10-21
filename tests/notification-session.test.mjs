import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const root=new URL('../',import.meta.url);
const cloudImport=source=>source.match(/import \* as cloud from ["']([^"']+)["']/)?.[1];

test('strategy notifications share the app login session across sign-in, token renewal and sign-out',async(t)=>{
  const directory=await mkdtemp(join(tmpdir(),'wealth-notification-session-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const fixture=pathToFileURL(directory+'/');
  await writeFile(join(directory,'package.json'),'{"type":"module"}');
  for(const file of ['config.js','core.js','review.js','review-store.js','notifications.js'])await copyFile(new URL(file,root),join(directory,file));
  // Keep actual ES module URLs and module state. Replace only remote SDK imports,
  // so differently versioned store imports reproduce the real browser failure.
  const store=(await readFile(new URL('store.js',root),'utf8')).replace(/https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/firebase-(app|auth|firestore)\.js/g,'./firebase-$1.js');
  await writeFile(join(directory,'store.js'),store);
  await writeFile(join(directory,'firebase-app.js'),'export const getApps=()=>[]; export const initializeApp=()=>({});');
  await writeFile(join(directory,'firebase-auth.js'),'export const auth={currentUser:null}; export const getAuth=()=>auth; export const getRedirectResult=async()=>null; export const onAuthStateChanged=()=>()=>{};');
  await writeFile(join(directory,'firebase-firestore.js'),'export const getFirestore=()=>({});');
  const app=await readFile(new URL('app.js',root),'utf8');
  const cloud=await import(new URL(cloudImport(app),fixture));
  const notifications=await import(new URL(app.match(/import \* as notifications from ["']([^"']+)["']/)[1],fixture));
  await cloud.connect();
  const {auth}=await import(new URL('./firebase-auth.js',fixture));
  let token='first-valid-token';
  auth.currentUser={uid:'author',getIdToken:async()=>token};
  const requests=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    requests.push({path:new URL(url).pathname,authorization:options.headers.Authorization,body:JSON.parse(options.body)});
    return Response.json({ok:true,sent:1,failed:0});
  });
  assert.equal(cloud.currentUserId(),'author');
  await notifications.strategyPublished({id:'post',published:true});
  token='renewed-valid-token';
  await notifications.strategyPublished({id:'post',published:true});
  assert.deepEqual(requests.map(request=>request.authorization),['Bearer first-valid-token','Bearer renewed-valid-token']);
  assert.ok(requests.every(request=>request.path==='/strategy-event'&&request.body.postId==='post'));
  auth.currentUser=null;
  await assert.rejects(notifications.strategyPublished({id:'post',published:true}),/登入狀態已失效/);
  assert.equal(requests.length,2,'signed-out requests must never reach the Worker');
});

test('app and notifications always resolve to the same authenticated store module',async()=>{
  const app=await readFile(new URL('app.js',root),'utf8');
  const notifications=await readFile(new URL('notifications.js',root),'utf8');
  const notificationUrl=new URL(app.match(/import \* as notifications from ["']([^"']+)["']/)[1],root);
  assert.equal(new URL(cloudImport(app),root).href,new URL(cloudImport(notifications),notificationUrl).href);
});
