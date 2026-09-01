const CACHE_NAME = "newtel-ebook-v185";
const META_CACHE_NAME = "newtel-ebook-meta-v185";
const SHELL_TTL = 24 * 60 * 60 * 1000;

// Only the entry shell is preloaded. Every other project is cached lazily
// after the user opens it, so unused applications are never downloaded.
const CORE_FILES = ["./","ebook.html","manifest.json","icon-192.png","icon-512.png","session-idle.js"];

self.addEventListener("install", event => {
  event.waitUntil(
    Promise.all([caches.open(CACHE_NAME),caches.open(META_CACHE_NAME)]).then(async ([cache,meta]) => {
      await cache.addAll(CORE_FILES).catch(() => null);
      const savedAt=String(Date.now());
      await Promise.all(CORE_FILES.map(file=>meta.put(new URL(file,self.location.href).href,new Response(savedAt))));
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => ![CACHE_NAME,META_CACHE_NAME].includes(key)).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;
  const url=new URL(request.url);
  const sameOrigin=url.origin===self.location.origin;
  const cacheableShell=sameOrigin&&(request.mode==="navigate"||/\.(?:html|css|js|json|png|jpe?g|avif|webp|svg)$/i.test(url.pathname)||url.pathname.endsWith("/"));
  if(!cacheableShell){event.respondWith(fetch(request).catch(()=>caches.match(request)));return}

  event.respondWith((async()=>{
    const cache=await caches.open(CACHE_NAME);
    const meta=await caches.open(META_CACHE_NAME);
    const canonical=new URL(url.pathname,self.location.origin).href;
    const cached=await cache.match(canonical,{ignoreSearch:true});
    const savedResponse=await meta.match(canonical);
    const savedAt=Number(savedResponse?await savedResponse.text():0);
    const forceReload=request.cache==="reload"||request.cache==="no-cache";
    // Serve visited pages immediately from cache and refresh them quietly in
    // the background. A hard refresh still bypasses the cached copy.
    if(cached&&!forceReload&&savedAt&&Date.now()-savedAt<SHELL_TTL){
      event.waitUntil(fetch(request).then(async fresh=>{if(fresh.ok){await cache.put(canonical,fresh.clone());await meta.put(canonical,new Response(String(Date.now())))}}).catch(()=>null));
      return cached;
    }
    try{
      const fresh=await fetch(request);
      if(fresh.ok){await cache.put(canonical,fresh.clone());await meta.put(canonical,new Response(String(Date.now())))}
      return fresh;
    }catch(error){return cached||await cache.match(new URL("ebook.html",self.location.origin).href)||Response.error()}
  })());
});
