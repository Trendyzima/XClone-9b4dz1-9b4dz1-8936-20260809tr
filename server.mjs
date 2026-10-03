import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.join(root, 'dist');
const runtimeApiRoot = path.join(root, '.runtime', 'api');

const apiRoutes = new Map([
  ['/api/capability', ['capability', 'request']],
  ['/api/health', ['health', 'request']],
  ['/api/ready', ['ready', 'request']],
  ['/api/home-discovery', ['home-discovery', 'request']],
  ['/api/home-feed', ['home-feed', 'request']],
  ['/api/live', ['live', 'request']],
  ['/api/sitemap-community', ['sitemap-community', 'request']],
  ['/api/sitemap-users', ['sitemap-users', 'request']],
  ['/api/auth/send-sms', ['auth/send-sms', 'node']],
  ['/api/media', ['media', 'node']],
  ['/api/story-cleanup', ['story-cleanup', 'node']],
]);

const supabaseOrigin = 'https://ffrhglgkukgsuhxenena.supabase.co';
function cleanHeaderValue(value) { return String(value ?? '').replace(/[\r\n]/g, ''); }
function setCommonHeaders(res) { res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','strict-origin-when-cross-origin'); res.setHeader('X-Frame-Options','SAMEORIGIN'); }
function sendText(res,status,body,contentType='text/plain; charset=utf-8'){setCommonHeaders(res);res.statusCode=status;res.setHeader('Content-Type',contentType);res.end(body);}
function sendJson(res,status,body){setCommonHeaders(res);res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body));}

class VercelResponseAdapter {
  constructor(res){this.res=res;}
  status(code){this.res.statusCode=code;return this;}
  setHeader(name,value){this.res.setHeader(name,cleanHeaderValue(value));return this;}
  getHeader(name){return this.res.getHeader(name);}
  json(body){if(!this.res.headersSent)this.res.setHeader('Content-Type','application/json; charset=utf-8');this.res.end(JSON.stringify(body));return this;}
  send(body){this.res.end(body);return this;}
  end(body=undefined){this.res.end(body);return this;}
}

async function readBody(req,limit=4*1024*1024){const chunks=[];let total=0;for await(const chunk of req){total+=chunk.length;if(total>limit)throw new Error('REQUEST_BODY_TOO_LARGE');chunks.push(chunk);}return Buffer.concat(chunks);}
async function loadApiHandler(relativePath){const modulePath=pathToFileURL(path.join(runtimeApiRoot,`${relativePath}.js`)).href;const mod=await import(modulePath);return mod.default;}

async function invokeRequestHandler(req,res,handler){
  let body;
  if(!['GET','HEAD'].includes(req.method??'GET')) body=await readBody(req);
  const headers=new Headers();
  for(const [key,value] of Object.entries(req.headers)){if(Array.isArray(value))headers.set(key,value.join(', '));else if(value!=null)headers.set(key,String(value));}
  const host=headers.get('host')||'testagram.site';
  const protocol=headers.get('x-forwarded-proto')||'http';
  const url=new URL(req.url||'/',`${protocol}://${host}`);
  const request=new Request(url,{method:req.method,headers,body:body&&body.length?body:undefined});
  const response=await handler(request);
  response.headers.forEach((value,key)=>res.setHeader(key,value));
  res.statusCode=response.status;
  res.end(response.body?Buffer.from(await response.arrayBuffer()):undefined);
}

async function invokeNodeHandler(req,res,handler){
  req.body=undefined;
  if(req.method!=='GET'&&req.method!=='HEAD'){
    const contentType=String(req.headers['content-type']||'');
    if(!contentType.includes('application/json')){
      if(!req.url?.startsWith('/api/auth/send-sms')) req.body=(await readBody(req)).toString('utf8');
    }else{const body=await readBody(req);try{req.body=body.length?JSON.parse(body.toString('utf8')):{};}catch{req.body={};}}
  }
  await handler(req,new VercelResponseAdapter(res));
}

async function proxySupabase(req,res,targetPath){
  const body=['GET','HEAD'].includes(req.method??'GET')?undefined:await readBody(req,16*1024*1024);
  const target=new URL(targetPath,supabaseOrigin);
  const headers=new Headers();
  for(const [key,value] of Object.entries(req.headers)){if(key.toLowerCase()==='host')continue;if(Array.isArray(value))headers.set(key,value.join(', '));else if(value!=null)headers.set(key,String(value));}
  const response=await fetch(target,{method:req.method,headers,body:body&&body.length?body:undefined,redirect:'manual'});
  res.statusCode=response.status;
  response.headers.forEach((value,key)=>{if(!['content-length','transfer-encoding','connection'].includes(key.toLowerCase()))res.setHeader(key,value);});
  res.end(Buffer.from(await response.arrayBuffer()));
}

function supabaseRewrite(p){
  if(p==='/.well-known/webfinger')return '/functions/v1/mastodon-edge/.well-known/webfinger';
  if(p==='/.well-known/nodeinfo')return '/functions/v1/mastodon-federation/.well-known/nodeinfo';
  if(p==='/.well-known/oauth-authorization-server')return '/functions/v1/mastodon-api/.well-known/oauth-authorization-server';
  if(p==='/nodeinfo/2.0')return '/functions/v1/mastodon-federation/nodeinfo/2.0';
  if(p==='/inbox')return '/functions/v1/mastodon-edge/inbox';
  const user=p.match(/^\/users\/([^/]+)(\/.*)?$/);if(user)return `/functions/v1/mastodon-edge/users/${user[1]}${user[2]||''}`;
  const api=p.match(/^\/api\/(v1|v2)\/(.*)$/);if(api)return `/functions/v1/mastodon-api/api/${api[1]}/${api[2]}`;
  const oauth=p.match(/^\/oauth\/(.*)$/);if(oauth)return `/functions/v1/mastodon-api/oauth/${oauth[1]}`;
  return null;
}

function serveStatic(req,res,urlPath){
  let relative=decodeURIComponent(urlPath);if(relative==='/'||relative==='')relative='/index.html';
  let file=path.resolve(distRoot,'.'+relative);if(!file.startsWith(distRoot+path.sep))return sendText(res,400,'Invalid path');
  if(!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(distRoot,'index.html');
  if(!fs.existsSync(file))return sendText(res,503,'Application build is unavailable');
  setCommonHeaders(res);
  const ext=path.extname(file).toLowerCase();
  if(ext==='.js'||ext==='.mjs'||ext==='.css')res.setHeader('Cache-Control','public, max-age=31536000, immutable');
  else if(ext==='.xml')res.setHeader('Cache-Control','public, max-age=86400');
  else if(ext==='.json'||ext==='.html')res.setHeader('Cache-Control','no-store');
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.xml':'application/xml; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8'};
  res.setHeader('Content-Type',types[ext]||'application/octet-stream');fs.createReadStream(file).pipe(res);
}

const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);const p=url.pathname;
    if(p==='/api/tv-cloudflare-ingest'||p==='/api/tv-youtube-ingest')return sendJson(res,501,{ok:false,error:'TV encoder WebSocket service is deployed separately during the Vercel migration.'});
    const supabasePath=supabaseRewrite(p);if(supabasePath)return await proxySupabase(req,res,`${supabasePath}${url.search}`);
    const route=apiRoutes.get(p);if(route){const [moduleName,mode]=route;const handler=await loadApiHandler(moduleName);if(mode==='node')return await invokeNodeHandler(req,res,handler);return await invokeRequestHandler(req,res,handler);}
    if(p==='/sitemap-community.xml'){const h=await loadApiHandler('sitemap-community');return await invokeRequestHandler(req,res,h);}
    if(p==='/sitemap-users.xml'){const h=await loadApiHandler('sitemap-users');return await invokeRequestHandler(req,res,h);}
    return serveStatic(req,res,p);
  }catch(error){console.error('[testagram-hosting] request failed',error);if(!res.headersSent)sendJson(res,500,{ok:false,error:'Internal server error'});else res.destroy();}
});
const port=Number(process.env.PORT||8080);server.listen(port,'0.0.0.0',()=>console.log(`[testagram-hosting] listening on ${port}`));
