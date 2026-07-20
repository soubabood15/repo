const CACHE_NAME = "newtel-ebook-v89";
const META_CACHE_NAME = "newtel-ebook-meta-v89";
const SHELL_TTL = 30 * 60 * 1000;

const CORE_FILES = [
  "./",
  "ebook.html",
  "kb_admin.html",
  "trainerkb.html",
  "tracking.js",
  "project-theme.css",
  "project-theme.js",
  "login-guard.js",
  "day-toggle.jpeg",
  "manifest.json",
  "icon-192.png",
  "icon-512.png",
  "icon7.html",
  "index.html",
  "saraya-waterpark.html",
  "himma.png",
  "icon7.jpeg",
  "Saraya_Aqaba_Waterpark_Logo.jpg"
];

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
    // Navigations must check the network so permission/login fixes are not
    // hidden for 30 minutes. Static assets keep the lightweight TTL cache.
    if(request.mode!=="navigate"&&cached&&!forceReload&&savedAt&&Date.now()-savedAt<SHELL_TTL)return cached;
    try{
      const fresh=await fetch(request);
      if(fresh.ok){await cache.put(canonical,fresh.clone());await meta.put(canonical,new Response(String(Date.now())))}
      return fresh;
    }catch(error){return cached||await cache.match(new URL("ebook.html",self.location.origin).href)||Response.error()}
  })());
});
