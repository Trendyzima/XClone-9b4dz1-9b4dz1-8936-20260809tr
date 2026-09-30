type YouTubeSessionStatus='connecting'|'encoding'|'reconnecting'|'stopped';
type Options={streamId:string;encoderToken:string;program:MediaStream;videoBitsPerSecond:number;onStatus?:(status:YouTubeSessionStatus,detail?:string)=>void};

const socketUrl=(id:string,t:string)=>{const p=window.location.protocol==="https:"?"wss:":"ws:";return p+"//"+window.location.host+"/api/tv-youtube-ingest?stream_id="+encodeURIComponent(id)+"&encoder_token="+encodeURIComponent(t)};

function pickMime(){
 const candidates=["video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm"];
 return candidates.find(x=>typeof MediaRecorder!=="undefined"&&MediaRecorder.isTypeSupported(x))||"";
}

export class TestagramTvYouTubeSession{
 private readonly options:Options;private socket:WebSocket|null=null;private recorder:MediaRecorder|null=null;private stopped=false;private reconnectTimer:number|null=null;private rotationTimer:number|null=null;private reconnectAttempts=0;private connectPromise:Promise<void>|null=null;private status:YouTubeSessionStatus="connecting";
 constructor(o:Options){this.options=o}
 static async connect(o:Options){const s=new TestagramTvYouTubeSession(o);await s.openTransport();return s}
 private setStatus(s:YouTubeSessionStatus,d?:string){this.status=s;this.options.onStatus?.(s,d)}
 private stopRecorder(){if(this.recorder){try{this.recorder.stop()}catch{}this.recorder=null}}
 private scheduleReconnect(){
  if(this.stopped||this.reconnectTimer!==null)return;
  const delay=Math.min(10000,500*Math.pow(2,Math.min(this.reconnectAttempts,4)));this.reconnectAttempts++;
  this.setStatus("reconnecting","YouTube encoder reconnect "+this.reconnectAttempts);
  this.reconnectTimer=window.setTimeout(()=>{this.reconnectTimer=null;this.connectPromise=null;void this.openTransport().catch(()=>this.scheduleReconnect())},delay);
 }
 private scheduleRotation(){
  if(this.rotationTimer!==null)window.clearTimeout(this.rotationTimer);
  // Current Vercel plan caps this function at 300s. Recycle before the hard cap
  // so the same YouTube stream key can continue receiving after reconnect.
  this.rotationTimer=window.setTimeout(()=>{this.rotationTimer=null;if(this.stopped)return;this.setStatus("reconnecting","Refreshing the Vercel YouTube encoder session before the 300s function limit.");this.socket?.close(1000,"planned encoder refresh")},240000);
 }
 private async openTransport(){
  if(this.stopped)return;
  if(this.connectPromise)return this.connectPromise;
  this.connectPromise=new Promise<void>((resolve,reject)=>{
   const socket=new WebSocket(socketUrl(this.options.streamId,this.options.encoderToken));this.socket=socket;let settled=false;
   const fail=(m:string)=>{if(settled)return;settled=true;reject(new Error(m))};
   socket.binaryType="arraybuffer";
   socket.onopen=()=>this.setStatus("connecting");
   socket.onmessage=e=>{
    if(typeof e.data!=="string")return;let m:any;try{m=JSON.parse(e.data)}catch{return}
    if(m.type==="ready"){settled=true;try{this.startRecorder();this.reconnectAttempts=0;this.setStatus("encoding");this.scheduleRotation();resolve()}catch(err){fail(err instanceof Error?err.message:"Could not start the browser encoder.");socket.close(1011,"recorder start failed")}}
    else if(m.type==="error")fail(m.message||"YouTube encoder rejected the stream.")
   };
   socket.onerror=()=>fail("YouTube encoder connection failed.");
   socket.onclose=()=>{this.socket=null;this.stopRecorder();if(this.rotationTimer!==null){window.clearTimeout(this.rotationTimer);this.rotationTimer=null}if(!this.stopped){if(!settled)fail("YouTube encoder connection closed before it became ready.");this.scheduleReconnect()}else if(!settled)fail("YouTube encoder connection closed before it became ready.")};
  }).finally(()=>{this.connectPromise=null});
  return this.connectPromise;
 }
 private startRecorder(){
  this.stopRecorder();const mime=pickMime();if(!mime)throw new Error("This browser cannot encode a WebM live contribution for the YouTube encoder.");
  const r=new MediaRecorder(this.options.program,{mimeType:mime,videoBitsPerSecond:Math.min(this.options.videoBitsPerSecond,8000000),audioBitsPerSecond:128000});
  r.ondataavailable=e=>{if(e.data.size&&this.socket?.readyState===WebSocket.OPEN)this.socket.send(e.data)};
  r.onerror=()=>this.scheduleReconnect();r.onstop=()=>{if(!this.stopped&&this.socket?.readyState===WebSocket.OPEN)this.scheduleReconnect()};
  this.recorder=r;r.start(1000);
 }
 getStatus(){return this.status}
 getDiagnostics(){return{provider:"youtube",status:this.status,streamId:this.options.streamId,transport:"websocket-webm-ffmpeg-rtmps-youtube"}}
 async close(){return this.stop()}
 async stop(){this.stopped=true;if(this.reconnectTimer!==null)window.clearTimeout(this.reconnectTimer);if(this.rotationTimer!==null)window.clearTimeout(this.rotationTimer);this.stopRecorder();const s=this.socket;this.socket=null;if(s&&s.readyState!==WebSocket.CLOSED)s.close(1000,"broadcast stopped");this.setStatus("stopped")}
}
