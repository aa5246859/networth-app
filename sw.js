const CACHE="wealth-tracker-v2.4.21";
const SHELL=["./","./index.html","./styles.css","./app.js","./core.js","./quotes.js","./store.js","./review.js","./review-store.js","./backup.js","./config.js","./icons.js","./notifications.js","./manifest.json","./icon-192.png","./icon-512.png"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));self.skipWaiting();});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith("wealth-tracker-")||k.startsWith("qwjh-")).filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener("fetch",event=>{
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin||event.request.method!=="GET"||!SHELL.some(path=>new URL(path,self.registration.scope).pathname===url.pathname))return;
  // Market requests and Firebase data are never cached by this service worker.
  event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}return response;}).catch(async()=>{const cached=await caches.match(event.request,{ignoreSearch:true});if(cached)return cached;if(event.request.mode==="navigate")return caches.match("./index.html");return Response.error();}));
});
self.addEventListener("push",event=>{
  let payload={};try{payload=event.data?.json()||{}}catch{payload={body:event.data?.text()||""}}
  const data=payload.data||payload.notification||payload;
  const title=data.title||"Wealth Tracker";
  const options={body:data.body||"有新的資產與策略提醒。",icon:"./icon-192.png",badge:"./icon-192.png",tag:data.eventKey||undefined,data:{url:data.url||"./#home"},renotify:false};
  event.waitUntil(self.registration.showNotification(title,options));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||"./#home",self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(clients=>{
    const existing=clients.find(client=>client.url.startsWith(self.registration.scope));
    if(existing){existing.navigate(target);return existing.focus();}
    return self.clients.openWindow(target);
  }));
});
