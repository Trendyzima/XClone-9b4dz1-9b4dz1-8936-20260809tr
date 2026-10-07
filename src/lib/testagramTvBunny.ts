type BunnySessionStatus='connecting'|'encoding'|'reconnecting'|'stopped';
type Options={streamId:string;encoderToken:string;program:MediaStream;videoBitsPerSecond:number;quality?:string;onStatus?:(status:BunnySessionStatus,detail?:string)=>void};

const socketUrl=(id:string,t:string,q:string)=>{
  const p=window.location.protocol==="https:"?"wss:":"ws:";
  return p+"//"+window.location.host+"/api/tv-bunny-ingest?stream_id="+encodeURIComponent(id)+"&encoder_token="+encodeURIComponent(t)+"&quality="+encodeURIComponent(q);
};

function pickMime(){
  const candidates=["video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm"];
  return candidates.find(x=>typeof MediaRecorder!=="undefined"&&MediaRecorder.isTypeSupported(x))||"";
}

export class TestagramTvBunnySession{
 private readonly options:Options;
 private socket:WebSocket|null=null;
 private recorder:MediaRecorder|null=null;
 private stopped=false;
 private reconnectTimer:number|null=null;
 private reconnectAttempts=0;
 private connectPromise:Promise<void>|null=null;
 private status:BunnySessionStatus="connecting";
 constructor(o:Options){this.options=o}
 static async connect(o:Options){const s=new TestagramTvBunnySession(o);await s.openTransport();return s}
 private setStatus(s:BunnySessionStatus,d?:string){this.status=s;this.options.onStatus?.(s,d)}
 private stopRecorder(){if(this.recorder){try{this.recorder.stop()}catch{}this.recorder=null}}
 private scheduleReconnect(){
  if(this.stopped||this.reconnectTimer!==null)return;
  const delay=Math.min(10000,500*Math.pow(2,Math.min(this.reconnectAttempts,4)));this.reconnectAttempts++;
  this.setStatus("reconnecting","Bunny encoder reconnect "+this.reconnectAttempts);
  this.reconnectTimer=window.setTimeout(()=>{this.reconnectTimer=null;this.connectPromise=null;void this.openTransport().catch(()=>this.scheduleReconnect())},delay);
 }
 private async openTransport(){
  if(this.stopped)return;
  if(this.connectPromise)return this.connectPromise;
  this.connectPromise=new Promise<void>((resolve,reject)=>{
   const socket=new WebSocket(socketUrl(this.options.streamId,this.options.encoderToken,this.options.quality||"1080p"));this.socket=socket;let settled=false;
   const fail=(m:string)=>{if(settled)return;settled=true;reject(new Error(m))};
   socket.binaryType="arraybuffer";
   socket.onopen=()=>this.setStatus("connecting");
   socket.onmessage=e=>{
    if(typeof e.data!=="string")return;
    let m:any;try{m=JSON.parse(e.data)}catch{return}
    if(m.type==="ready"){settled=true;try{this.startRecorder();this.reconnectAttempts=0;this.setStatus("encoding");resolve()}catch(err){fail(err instanceof Error?err.message:"Could not start the browser encoder.");socket.close(1011,"recorder start failed")}}
    else if(m.type==="error")fail(m.message||"Bunny encoder rejected the stream.");
   };
   socket.onerror=()=>fail("Bunny encoder connection failed.");
   socket.onclose=()=>{this.socket=null;this.stopRecorder();if(!this.stopped){if(!settled)fail("Bunny encoder connection closed before it became ready.");this.scheduleReconnect()}else if(!settled)fail("Bunny encoder connection closed before it became ready.")};
  }).finally(()=>{this.connectPromise=null});
  return this.connectPromise;
 }
 private startRecorder(){
  this.stopRecorder();
  const mime=pickMime();
  if(!mime)throw new Error("This browser cannot encode a WebM live contribution for the Bunny encoder.");
  const r=new MediaRecorder(this.options.program,{mimeType:mime,videoBitsPerSecond:this.options.videoBitsPerSecond,audioBitsPerSecond:128000});
  r.ondataavailable=e=>{if(e.data.size&&this.socket?.readyState===WebSocket.OPEN)this.socket.send(e.data)};
  r.onerror=()=>this.scheduleReconnect();
  r.onstop=()=>{if(!this.stopped&&this.socket?.readyState===WebSocket.OPEN)this.scheduleReconnect()};
  r.onstart=()=>this.setStatus("encoding");
  this.recorder=r;
  r.start(1000);
 }
 getStatus(){return this.status}
 getDiagnostics(){return{provider:"bunny",status:this.status,streamId:this.options.streamId,transport:"websocket-webm-ffmpeg-rtmp-bunny",reconnectWindowMs:10000,liveOutputResolution:"1920x1080"}}
 async close(){return this.stop()}
 async stop(){this.stopped=true;if(this.reconnectTimer!==null)window.clearTimeout(this.reconnectTimer);this.stopRecorder();const s=this.socket;this.socket=null;if(s&&s.readyState!==WebSocket.CLOSED)s.close(1000,"broadcast stopped");this.setStatus("stopped")}
}
