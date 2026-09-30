import {createServer} from "node:http";
import {spawn,type ChildProcessWithoutNullStreams} from "node:child_process";
import {WebSocketServer} from "ws";
import ffmpegPath from "ffmpeg-static";

const supabaseUrl=(process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL||"").replace(/\/$/,"");
const supabaseKey=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY||process.env.VITE_SUPABASE_PUBLISHABLE_KEY||process.env.VITE_SUPABASE_ANON_KEY||"";

async function config(id:string,t:string){
 if(!supabaseUrl||!supabaseKey)throw new Error("Supabase TV control is not configured.");
 const r=await fetch(supabaseUrl+"/functions/v1/tv-media-control",{method:"POST",headers:{"Content-Type":"application/json",apikey:supabaseKey,Authorization:"Bearer "+supabaseKey},body:JSON.stringify({action:"youtube-encoder-config",stream_id:id,encoder_token:t})});
 const p=await r.json().catch(()=>null);
 if(!r.ok||!p?.ok||!p?.data?.rtmps_ingestion_address||!p?.data?.stream_name)throw new Error(p?.error?.message||"YouTube encoder configuration is unavailable.");
 return p.data as {rtmps_ingestion_address:string;stream_name:string};
}

const server=createServer((_q,res)=>{res.statusCode=426;res.setHeader("Content-Type","application/json");res.end(JSON.stringify({ok:false,error:{message:"WebSocket connection required."}}))});
const wss=new WebSocketServer({server,maxPayload:8*1024*1024});

wss.on("connection",(socket,request)=>{
 const u=new URL(request.url||"/","https://tv.testagram.local"),id=u.searchParams.get("stream_id")||"",token=u.searchParams.get("encoder_token")||"";
 if(!id||!token){socket.close(1008,"YouTube encoder session is required.");return}
 if(!ffmpegPath){socket.close(1011,"FFmpeg encoder binary is unavailable.");return}
 let ffmpeg:ChildProcessWithoutNullStreams|null=null,initialized=false;
 const close=()=>{if(!ffmpeg)return;try{ffmpeg.stdin.end()}catch{}try{ffmpeg.kill("SIGTERM")}catch{}ffmpeg=null};
 socket.on("message",async(data,isBinary)=>{
  if(!isBinary)return;
  try{
   if(!initialized){
    initialized=true;
    const c=await config(id,token),ingest=c.rtmps_ingestion_address.replace(/\/$/,"")+"/"+c.stream_name;
    ffmpeg=spawn(ffmpegPath as string,["-hide_banner","-loglevel","warning","-fflags","+genpts","-f","webm","-i","pipe:0","-c:v","libx264","-preset","veryfast","-tune","zerolatency","-vf","scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease","-profile:v","main","-pix_fmt","yuv420p","-r","30","-g","60","-keyint_min","60","-sc_threshold","0","-b:v","8M","-maxrate","8M","-bufsize","16M","-c:a","aac","-ar","48000","-ac","2","-b:a","128k","-f","flv",ingest]);
    ffmpeg.stderr.on("data",c=>{const line=String(c).trim();if(line)console.warn("[Testagram TV YouTube encoder]",line.slice(0,500))});
    ffmpeg.on("error",e=>{try{socket.send(JSON.stringify({type:"error",message:"YouTube encoder process failed: "+e.message}))}catch{}close();try{socket.close(1011,"encoder failed")}catch{}});
    ffmpeg.on("exit",code=>{if(code!==0&&socket.readyState===1)try{socket.send(JSON.stringify({type:"error",message:"YouTube encoder stopped unexpectedly ("+code+")."}))}catch{};ffmpeg=null});
    socket.send(JSON.stringify({type:"ready"}));
   }
   if(ffmpeg?.stdin.writable)ffmpeg.stdin.write(Buffer.isBuffer(data)?data:Buffer.from(data as any));
  }catch(e:any){try{socket.send(JSON.stringify({type:"error",message:e?.message||"Could not start YouTube encoder."}))}catch{}close();try{socket.close(1011,"encoder setup failed")}catch{}}
 });
 socket.on("close",close);socket.on("error",close);
});
export default server;
