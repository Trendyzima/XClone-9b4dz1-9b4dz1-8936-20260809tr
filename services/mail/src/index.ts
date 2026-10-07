import http from "node:http";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";

const PORT=Number(process.env.PORT||8080);
const TOKEN=process.env.TESTAGRAM_MAIL_TOKEN||"";
const SUPABASE_URL=process.env.SUPABASE_URL||"";
const SUPABASE_SECRET_KEY=process.env.SUPABASE_SECRET_KEY||"";
const FROM_DEFAULT=process.env.TESTAGRAM_MAIL_FROM||"Testagram <noreply@testagram.site>";
const DIRECT_SMTP=process.env.TESTAGRAM_MAIL_DIRECT_SMTP==="true";
const SMTP_HOST=process.env.TESTAGRAM_MAIL_SMTP_HOST||"";
const SMTP_PORT=Number(process.env.TESTAGRAM_MAIL_SMTP_PORT||587);
const SMTP_USER=process.env.TESTAGRAM_MAIL_SMTP_USER||"";
const SMTP_PASS=process.env.TESTAGRAM_MAIL_SMTP_PASS||"";
const SMTP_SECURE=process.env.TESTAGRAM_MAIL_SMTP_SECURE==="true";
const MAX_BODY=Number(process.env.TESTAGRAM_MAIL_MAX_BYTES||1048576);
const MAX_ATTEMPTS=Number(process.env.TESTAGRAM_MAIL_MAX_ATTEMPTS||5);
const RATE_LIMIT_PER_MINUTE=Number(process.env.TESTAGRAM_MAIL_RATE_LIMIT_PER_MINUTE||120);
const requestCounts=new Map<number,number>();
const DKIM_DOMAIN=process.env.TESTAGRAM_MAIL_DKIM_DOMAIN||"";
const DKIM_SELECTOR=process.env.TESTAGRAM_MAIL_DKIM_SELECTOR||"";
const DKIM_PRIVATE_KEY=(process.env.TESTAGRAM_MAIL_DKIM_PRIVATE_KEY||"").replace(/\\n/g,"\\n");

if(!TOKEN) console.warn("TESTAGRAM_MAIL_TOKEN is not configured");
const db=SUPABASE_URL&&SUPABASE_SECRET_KEY?createClient(SUPABASE_URL,SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}}):null;

type MailInput={from?:string;to:string|string[];cc?:string|string[];bcc?:string|string[];reply_to?:string|string[];replyTo?:string|string[];subject:string;html?:string;text?:string;headers?:Record<string,string>;scheduled_at?:string|null};
type MailRow={id:string;from_address:string;to_addresses:string[];cc_addresses:string[];bcc_addresses:string[];reply_to_addresses:string[];subject:string;html:string|null;text:string|null;headers:Record<string,string>;status:string;attempts:number;next_attempt_at:string|null;scheduled_at:string|null;created_at:string;sent_at:string|null;last_error:string|null;message_id:string|null};

const json=(res:http.ServerResponse,status:number,body:unknown)=>{const raw=JSON.stringify(body);res.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});res.end(raw);};
const id=()=>crypto.randomUUID();
const normalize=(v:string|string[]|undefined)=>Array.isArray(v)?v.map(x=>String(x).trim()).filter(Boolean):v?[String(v).trim()]:[];
const validEmail=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
async function readBody(req:http.IncomingMessage){const chunks:Buffer[]=[];let size=0;for await(const c of req){size+=Buffer.byteLength(c);if(size>MAX_BODY)throw Object.assign(new Error("PAYLOAD_TOO_LARGE"),{status:413});chunks.push(Buffer.from(c));}return JSON.parse(Buffer.concat(chunks).toString("utf8")||"{}");}
function rateAllowed(){const minute=Math.floor(Date.now()/60000);const count=requestCounts.get(minute)||0;if(count>=RATE_LIMIT_PER_MINUTE)return false;requestCounts.set(minute,count+1);for(const key of requestCounts.keys())if(key<minute-1)requestCounts.delete(key);return true;}
function auth(req:http.IncomingMessage){const supplied=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");if(!TOKEN||!supplied)return false;const a=Buffer.from(supplied),b=Buffer.from(TOKEN);return a.length===b.length&&crypto.timingSafeEqual(a,b);}
function normalizePayload(body:any):MailInput{const to=normalize(body.to);const cc=normalize(body.cc);const bcc=normalize(body.bcc);const reply=normalize(body.reply_to??body.replyTo);if(!to.length||[...to,...cc,...bcc].some(x=>!validEmail(x)))throw new Error("INVALID_RECIPIENT");if(typeof body.subject!=="string"||!body.subject.trim())throw new Error("SUBJECT_REQUIRED");if(typeof body.html!=="string"&&typeof body.text!=="string")throw new Error("CONTENT_REQUIRED");return {from:typeof body.from==="string"&&body.from.trim()?body.from.trim():FROM_DEFAULT,to,cc,bcc,reply_to:reply,subject:body.subject.trim(),html:typeof body.html==="string"?body.html:null,text:typeof body.text==="string"?body.text:null,headers:body.headers&&typeof body.headers==="object"?body.headers:{},scheduled_at:body.scheduled_at??null};}
async function mx(domain:string){const rows=await dns.resolveMx(domain).catch(()=>[]);return rows.sort((a,b)=>a.priority-b.priority).map(x=>x.exchange);}
function transporter(host:string,port:number,secure:boolean){
  return nodemailer.createTransport({
    host,port,secure,
    auth:SMTP_USER?{user:SMTP_USER,pass:SMTP_PASS}:undefined,
    dkim:DKIM_DOMAIN&&DKIM_SELECTOR&&DKIM_PRIVATE_KEY?{domainName:DKIM_DOMAIN,keySelector:DKIM_SELECTOR,privateKey:DKIM_PRIVATE_KEY}:undefined,
    connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000
  });
}
async function deliver(row:MailRow){
  const messageBase={
    from:row.from_address,to:row.to_addresses,cc:row.cc_addresses,bcc:row.bcc_addresses,
    replyTo:row.reply_to_addresses,subject:row.subject,html:row.html||undefined,text:row.text||undefined,headers:row.headers
  };
  if(!DIRECT_SMTP){
    if(!SMTP_HOST)throw new Error("SMTP_NOT_CONFIGURED");
    const t=transporter(SMTP_HOST,SMTP_PORT,SMTP_SECURE);
    const info=await t.sendMail(messageBase);
    t.close();
    return info.messageId||null;
  }
  const recipients=[...row.to_addresses,...row.cc_addresses,...row.bcc_addresses];
  const groups=new Map<string,string[]>();
  for(const address of recipients){
    const domain=address.split("@")[1].toLowerCase();
    const list=groups.get(domain)||[]; list.push(address); groups.set(domain,list);
  }
  let lastMessageId:string|null=null;
  for(const [domain,addresses] of groups){
    const hosts=await mx(domain);
    if(!hosts.length)throw new Error("MX_NOT_FOUND:"+domain);
    let sent=false,last="";
    for(const host of hosts){
      try{
        const t=transporter(host,25,false);
        const info=await t.sendMail({...messageBase,to:addresses,cc:undefined,bcc:undefined});
        t.close();
        lastMessageId=info.messageId||lastMessageId;
        sent=true; break;
      }catch(e){last=e instanceof Error?e.message:String(e);}
    }
    if(!sent)throw new Error("SMTP_DELIVERY_FAILED:"+domain+":"+last);
  }
  return lastMessageId;
}
async function insertMail(payload:MailInput,key:string|null){
  if(!db)throw new Error("MAIL_DB_NOT_CONFIGURED");
  const requestHash=crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  if(key){
    const {data}=await db.from("mail_messages").select("*").eq("idempotency_key",key).maybeSingle();
    if(data){
      if(data.request_hash&&data.request_hash!==requestHash)throw Object.assign(new Error("IDEMPOTENCY_KEY_REUSED"),{status:409});
      return data as MailRow;
    }
  }
  const {data,error}=await db.from("mail_messages").insert({
    from_address:payload.from,to_addresses:payload.to,cc_addresses:payload.cc,bcc_addresses:payload.bcc,
    reply_to_addresses:payload.reply_to,subject:payload.subject,html:payload.html,text:payload.text,
    headers:payload.headers,idempotency_key:key,request_hash:requestHash,status:payload.scheduled_at?"scheduled":"queued",
    scheduled_at:payload.scheduled_at,updated_at:new Date().toISOString()
  }).select("*").single();
  if(error)throw error;
  return data as MailRow;
}
async function update(id:string,patch:Record<string,unknown>){
  if(!db)return;
  const {error}=await db.from("mail_messages").update({...patch,updated_at:new Date().toISOString()}).eq("id",id);
  if(error)throw new Error("MAIL_DB_UPDATE_FAILED");
}
async function worker(){if(!db)return;const now=new Date().toISOString();
  await db.from("mail_messages").update({status:"retry",next_attempt_at:now,last_error:"RECOVERED_STUCK_SENDING",updated_at:now}).eq("status","sending").lt("updated_at",new Date(Date.now()-5*60*1000).toISOString());
const {data,error}=await db.from("mail_messages").select("*") .in("status",["queued","retry","scheduled"]).lte("next_attempt_at",now).or("scheduled_at.is.null,scheduled_at.lte."+now).order("created_at",{ascending:true}).limit(10);if(error){console.error(error);return;}for(const row of (data||[]) as MailRow[]){const claimed=await db.from("mail_messages").update({status:"sending",attempts:row.attempts+1}).eq("id",row.id) .in("status",["queued","retry","scheduled"]).select("id");if(claimed.error||!claimed.data?.length)continue;try{const messageId=await deliver(row);await update(row.id,{status:"sent",sent_at:new Date().toISOString(),last_error:null,message_id:messageId,next_attempt_at:null});}catch(e){const attempts=row.attempts+1;const terminal=attempts>=MAX_ATTEMPTS;const delay=Math.min(3600,Math.pow(2,attempts)*15);await update(row.id,{status:terminal?"failed":"retry",next_attempt_at:terminal?null:new Date(Date.now()+delay*1000).toISOString(),last_error:e instanceof Error?e.message:String(e)});}}}
setInterval(()=>void worker(),2000).unref();

const server=http.createServer(async(req,res)=>{try{if(req.url==="/health"){return json(res,200,{ok:true,service:"testagram-mail"});}if(!auth(req))return json(res,401,{ok:false,error:{name:"authentication_error",message:"Unauthorized",statusCode:401}});if(req.method==="POST"&&req.url==="/emails"){if(!rateAllowed())return json(res,429,{data:null,error:{name:"rate_limit_error",message:"Too many requests",statusCode:429}});const body=await readBody(req);const payload=normalizePayload(body);const row=await insertMail(payload,req.headers["idempotency-key"]?String(req.headers["idempotency-key"]):null);return json(res,200,{data:{id:row.id},error:null});}const m=req.url?.match(/^\/emails\/([^/]+)$/);if(m&&req.method==="GET"){if(!db)throw new Error("MAIL_DB_NOT_CONFIGURED");const {data,error}=await db.from("mail_messages").select("*").eq("id",m[1]).maybeSingle();if(error)throw error;if(!data)return json(res,404,{data:null,error:{name:"not_found",message:"Email not found",statusCode:404}});return json(res,200,{data:{id:data.id,from:data.from_address,to:data.to_addresses,cc:data.cc_addresses,bcc:data.bcc_addresses,reply_to:data.reply_to_addresses,subject:data.subject,html:data.html,text:data.text,status:data.status,scheduled_at:data.scheduled_at,created_at:data.created_at,sent_at:data.sent_at,last_error:data.last_error},error:null});}if(m&&req.method==="DELETE"){await update(m[1],{status:"cancelled"});return json(res,200,{data:{id:m[1]},error:null});}return json(res,404,{ok:false,error:"NOT_FOUND"});}catch(e){const status=(e as any)?.status||500;console.error("TESTAGRAM_MAIL_ERROR",e);return json(res,status,{data:null,error:{name:"application_error",message:e instanceof Error?e.message:"Internal server error",statusCode:status}});}});
server.listen(PORT,"0.0.0.0",()=>console.log("Testagram Mail listening on "+PORT));