package main

import (
  "crypto/hmac"
  "crypto/sha256"
  "encoding/base64"
  "encoding/json"
  "fmt"
  "log"
  "net/http"
  "os"
  "strings"
  "sync"
  "time"

  "github.com/gorilla/websocket"
  "github.com/pion/webrtc/v4"
)

type claims struct {
  Role string `json:"role"`
  StreamID string `json:"stream_id"`
  Exp int64 `json:"exp"`
}

type signal struct {
  Type string `json:"type"`
  SDP string `json:"sdp,omitempty"`
  Candidate *webrtc.ICECandidateInit `json:"candidate,omitempty"`
}

type peer struct {
  ws *websocket.Conn
  pc *webrtc.PeerConnection
  role string
  mu sync.Mutex
  videoAttached bool
  audioAttached bool
}

type room struct {
  mu sync.Mutex
  host *peer
  viewers map[*peer]bool
  video *webrtc.TrackLocalStaticRTP
  audio *webrtc.TrackLocalStaticRTP
}

var rooms sync.Map
var upgrader = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}

func decodePart(v string) ([]byte,error) { return base64.RawURLEncoding.DecodeString(v) }

func verifyToken(token, secret string) (*claims,error) {
  parts:=strings.Split(token,".")
  if len(parts)!=3 { return nil,fmt.Errorf("invalid media token") }
  header,err:=decodePart(parts[0])
  if err!=nil || string(header)!="testagram-media-v1" { return nil,fmt.Errorf("invalid media token header") }
  payload,err:=decodePart(parts[1]); if err!=nil{return nil,err}
  signature,err:=decodePart(parts[2]); if err!=nil{return nil,err}
  mac:=hmac.New(sha256.New,[]byte(secret)); mac.Write(payload)
  if !hmac.Equal(signature,mac.Sum(nil)){return nil,fmt.Errorf("invalid media token signature")}
  var c claims
  if err=json.Unmarshal(payload,&c);err!=nil{return nil,err}
  if c.StreamID==""||c.Role==""||time.Now().Unix()>=c.Exp{return nil,fmt.Errorf("expired media token")}
  return &c,nil
}

func send(ws *websocket.Conn,m signal) error { ws.SetWriteDeadline(time.Now().Add(10*time.Second)); return ws.WriteJSON(m) }
func getRoom(id string)*room { v,_:=rooms.LoadOrStore(id,&room{viewers:map[*peer]bool{}}); return v.(*room) }
func closePeer(p *peer){ if p==nil{return}; _=p.ws.Close(); _=p.pc.Close() }

func addTracksToViewer(v *peer,r *room) error {
  r.mu.Lock(); video,audio:=r.video,r.audio; r.mu.Unlock()
  v.mu.Lock(); defer v.mu.Unlock()
  if video!=nil&&!v.videoAttached { if _,err:=v.pc.AddTrack(video);err!=nil{return err};v.videoAttached=true }
  if audio!=nil&&!v.audioAttached { if _,err:=v.pc.AddTrack(audio);err!=nil{return err};v.audioAttached=true }
  return nil
}

func renegotiateViewer(v *peer,r *room){
  if v.pc.ConnectionState()==webrtc.PeerConnectionStateClosed{return}
  if err:=addTracksToViewer(v,r);err!=nil{return}
  v.mu.Lock(); defer v.mu.Unlock()
  offer,err:=v.pc.CreateOffer(nil);if err!=nil{return}
  if err=v.pc.SetLocalDescription(offer);err!=nil{return}
  <-webrtc.GatheringCompletePromise(v.pc)
  if local:=v.pc.LocalDescription();local!=nil{_ = send(v.ws,signal{Type:"offer",SDP:local.SDP})}
}

func addHostTrack(r *room,remote *webrtc.TrackRemote){
  local,err:=webrtc.NewTrackLocalStaticRTP(remote.Codec().RTPCodecCapability,remote.Kind().String(),"testagram")
  if err!=nil{return}
  r.mu.Lock()
  if remote.Kind()==webrtc.RTPCodecTypeVideo {r.video=local}else{r.audio=local}
  viewers:=make([]*peer,0,len(r.viewers));for viewer:=range r.viewers{viewers=append(viewers,viewer)}
  r.mu.Unlock()
  go func(){for{packet,_,err:=remote.ReadRTP();if err!=nil{return};if err:=local.WriteRTP(packet);err!=nil{return}}}()
  for _,viewer:=range viewers{go renegotiateViewer(viewer,r)}
}

func handlePeer(p *peer,r *room){
  defer func(){
    r.mu.Lock()
    wasHost:=r.host==p
    if wasHost {r.host=nil;for viewer:=range r.viewers{go closePeer(viewer)};r.viewers=map[*peer]bool{};r.video=nil;r.audio=nil} else {delete(r.viewers,p)}
    r.mu.Unlock()
    closePeer(p)
  }()
  p.pc.OnTrack(func(track *webrtc.TrackRemote,_ *webrtc.RTPReceiver){if p.role=="host"&&(track.Kind()==webrtc.RTPCodecTypeVideo||track.Kind()==webrtc.RTPCodecTypeAudio){addHostTrack(r,track)}})
  for {
    var message signal
    if err:=p.ws.ReadJSON(&message);err!=nil{return}
    switch message.Type {
    case "offer":
      if err:=p.pc.SetRemoteDescription(webrtc.SessionDescription{Type:webrtc.SDPTypeOffer,SDP:message.SDP});err!=nil{return}
      if p.role=="viewer"{if err:=addTracksToViewer(p,r);err!=nil{return}}
      answer,err:=p.pc.CreateAnswer(nil);if err!=nil{return}
      if err=p.pc.SetLocalDescription(answer);err!=nil{return}
      <-webrtc.GatheringCompletePromise(p.pc)
      if local:=p.pc.LocalDescription();local!=nil{if err:=send(p.ws,signal{Type:"answer",SDP:local.SDP});err!=nil{return}}
    case "answer":
      if err:=p.pc.SetRemoteDescription(webrtc.SessionDescription{Type:webrtc.SDPTypeAnswer,SDP:message.SDP});err!=nil{return}
    case "candidate":
      if message.Candidate!=nil{_ = p.pc.AddICECandidate(*message.Candidate)}
    }
  }
}

func wsHandler(w http.ResponseWriter,req *http.Request){
  secret:=os.Getenv("MEDIA_ENGINE_SECRET");if secret==""{http.Error(w,"media engine not configured",503);return}
  c,err:=verifyToken(req.URL.Query().Get("token"),secret);if err!=nil{http.Error(w,"unauthorized",401);return}
  conn,err:=upgrader.Upgrade(w,req,nil);if err!=nil{return}
  publicIP:=strings.TrimSpace(os.Getenv("MEDIA_ENGINE_PUBLIC_IP"))
  setting:=webrtc.SettingEngine{}
  _=setting.SetEphemeralUDPPortRange(10000,20000)
  setting.SetICEMulticastDNSMode(webrtc.MulticastDNSModeDisabled)
  if publicIP!=""{setting.SetNAT1To1IPs([]string{publicIP},webrtc.ICECandidateTypeHost)}
  media:=&webrtc.MediaEngine{};if err:=media.RegisterDefaultCodecs();err!=nil{_ = conn.Close();return}
  api:=webrtc.NewAPI(webrtc.WithSettingEngine(setting),webrtc.WithMediaEngine(media))
  pc,err:=api.NewPeerConnection(webrtc.Configuration{ICEServers:[]webrtc.ICEServer{{URLs:[]string{"stun:stun.l.google.com:19302"}}}})
  if err!=nil{_ = conn.Close();return}
  p:=&peer{ws:conn,pc:pc,role:c.Role};r:=getRoom(c.StreamID)
  r.mu.Lock()
  if c.Role=="host" {if r.host!=nil{r.mu.Unlock();closePeer(p);return};r.host=p} else {r.viewers[p]=true}
  r.mu.Unlock()
  go handlePeer(p,r)
}

func health(w http.ResponseWriter,_ *http.Request){w.Header().Set("content-type","application/json");_,_=w.Write([]byte(`{"ok":true,"service":"testagram-media-engine","transport":"webrtc-sfu"}`))}

func main(){mux:=http.NewServeMux();mux.HandleFunc("/healthz",health);mux.HandleFunc("/ws",wsHandler);port:=os.Getenv("PORT");if port==""{port="8080"};log.Printf("Testagram Media Engine listening on :%s",port);log.Fatal(http.ListenAndServe(":"+port,mux))}
