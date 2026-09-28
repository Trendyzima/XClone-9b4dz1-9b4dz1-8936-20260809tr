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
  "sync/atomic"
  "strconv"
  "time"

  "github.com/gorilla/websocket"
  "github.com/pion/ice/v4"
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
  ViewerCount int `json:"viewer_count,omitempty"`
  GuestCount int `json:"guest_count,omitempty"`
}

type peer struct {
  ws *websocket.Conn
  pc *webrtc.PeerConnection
  role string
  mu sync.Mutex
  writeMu sync.Mutex
  videoAttached bool
  audioAttached bool
}

type room struct {
  mu sync.Mutex
  host *peer
  viewers map[*peer]bool
  guests map[*peer]bool
  video *webrtc.TrackLocalStaticRTP
  audio *webrtc.TrackLocalStaticRTP
  lastActivity time.Time
}

var rooms sync.Map
type rateEntry struct { started time.Time; count int }
var rateMu sync.Mutex
var connectionRates = map[string]rateEntry{}
var totalConnections atomic.Uint64
var rejectedConnections atomic.Uint64
var rtpPackets atomic.Uint64
var rtpWriteErrors atomic.Uint64
var upgrader = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool {
  raw := strings.TrimSpace(os.Getenv("MEDIA_ENGINE_ALLOWED_ORIGINS"))
  if raw == "" { return true }
  origin := strings.TrimRight(strings.TrimSpace(r.Header.Get("Origin")), "/")
  for _, allowed := range strings.Split(raw, ",") {
    if origin == strings.TrimRight(strings.TrimSpace(allowed), "/") { return true }
  }
  return false
}}

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
func (p *peer) send(m signal) error {
  p.writeMu.Lock()
  defer p.writeMu.Unlock()
  return send(p.ws,m)
}
func getRoom(id string)*room {
  v,_:=rooms.LoadOrStore(id,&room{viewers:map[*peer]bool{},guests:map[*peer]bool{},lastActivity:time.Now()})
  return v.(*room)
}
func roomPresence(r *room) signal {
  r.mu.Lock(); defer r.mu.Unlock()
  return signal{Type:"presence",ViewerCount:len(r.viewers),GuestCount:len(r.guests)}
}
func broadcastPresence(r *room) {
  r.mu.Lock()
  peers:=make([]*peer,0,len(r.viewers)+len(r.guests)+1)
  if r.host!=nil { peers=append(peers,r.host) }
  for p:=range r.viewers { peers=append(peers,p) }
  for p:=range r.guests { peers=append(peers,p) }
  presence:=signal{Type:"presence",ViewerCount:len(r.viewers),GuestCount:len(r.guests)}
  r.mu.Unlock()
  for _,p:=range peers { _=p.send(presence) }
}
func closePeer(p *peer){ if p==nil{return}; _=p.ws.Close(); _=p.pc.Close() }

func addTracksToViewer(v *peer, r *room) error {
  r.mu.Lock()
  video, audio := r.video, r.audio
  r.mu.Unlock()
  v.mu.Lock()
  defer v.mu.Unlock()
  if video != nil && !v.videoAttached {
    if _, err := v.pc.AddTrack(video); err != nil { return err }
    v.videoAttached = true
  }
  if audio != nil && !v.audioAttached {
    if _, err := v.pc.AddTrack(audio); err != nil { return err }
    v.audioAttached = true
  }
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

func relayTrack(targets []*peer, remote *webrtc.TrackRemote, name string) {
  local, err := webrtc.NewTrackLocalStaticRTP(remote.Codec().RTPCodecCapability, name, "testagram")
  if err != nil { return }
  go func() {
    for {
      packet, _, err := remote.ReadRTP()
      if err != nil { return }
      if err := local.WriteRTP(packet); err != nil { return }
    }
  }()
  for _, target := range targets {
    if target == nil { continue }
    target.mu.Lock()
    if remote.Kind() == webrtc.RTPCodecTypeVideo {
      if _, err := target.pc.AddTrack(local); err != nil { target.mu.Unlock(); continue }
      target.videoAttached = true
    } else {
      if _, err := target.pc.AddTrack(local); err != nil { target.mu.Unlock(); continue }
      target.audioAttached = true
    }
    target.mu.Unlock()
    go renegotiatePeer(target)
  }
}

func renegotiatePeer(p *peer) {
  if p.pc.ConnectionState() == webrtc.PeerConnectionStateClosed { return }
  p.mu.Lock()
  defer p.mu.Unlock()
  offer, err := p.pc.CreateOffer(nil)
  if err != nil { return }
  if err = p.pc.SetLocalDescription(offer); err != nil { return }
  <-webrtc.GatheringCompletePromise(p.pc)
  if local := p.pc.LocalDescription(); local != nil { _ = send(p.ws, signal{Type:"offer", SDP:local.SDP}) }
}

func addHostTrack(r *room, remote *webrtc.TrackRemote) {
  r.mu.Lock()
  viewers := make([]*peer, 0, len(r.viewers))
  for viewer := range r.viewers { viewers = append(viewers, viewer) }
  r.mu.Unlock()
  name := "program-video"
  if remote.Kind() == webrtc.RTPCodecTypeAudio { name = "program-audio" }
  local, err := webrtc.NewTrackLocalStaticRTP(remote.Codec().RTPCodecCapability, name, "testagram")
  if err != nil { return }
  r.mu.Lock()
  if remote.Kind() == webrtc.RTPCodecTypeVideo { r.video = local } else { r.audio = local }
  r.mu.Unlock()
  go func() {
    for {
      packet, _, err := remote.ReadRTP()
      if err != nil { return }
      if err := local.WriteRTP(packet); err != nil { return }
    }
  }()
  for _, viewer := range viewers { go renegotiateViewer(viewer, r) }
}

func addGuestTrack(r *room, remote *webrtc.TrackRemote) {
  r.mu.Lock()
  host := r.host
  r.mu.Unlock()
  if host == nil { return }
  name := "guest-video"
  if remote.Kind() == webrtc.RTPCodecTypeAudio { name = "guest-audio" }
  relayTrack([]*peer{host}, remote, name)
}

func handlePeer(p *peer,r *room){
  done:=make(chan struct{})
  defer close(done)
  go func(){
    ticker:=time.NewTicker(20*time.Second)
    defer ticker.Stop()
    for {
      select {
      case <-ticker.C:
        p.writeMu.Lock()
        _=p.ws.SetWriteDeadline(time.Now().Add(10*time.Second))
        err:=p.ws.WriteMessage(websocket.PingMessage,nil)
        p.writeMu.Unlock()
        if err!=nil { _=p.ws.Close(); return }
      case <-done:
        return
      }
    }
  }()
  defer func(){
    r.mu.Lock()
    wasHost:=r.host==p
    if wasHost {r.host=nil;for viewer:=range r.viewers{go closePeer(viewer)};for guest:=range r.guests{go closePeer(guest)};r.viewers=map[*peer]bool{};r.guests=map[*peer]bool{};r.video=nil;r.audio=nil} else {delete(r.viewers,p);delete(r.guests,p)}
    r.mu.Unlock()
    activeRooms:=0
    rooms.Range(func(_, _ any) bool { activeRooms++; return true })
    _=activeRooms
    broadcastPresence(r)
    closePeer(p)
  }()
  p.ws.SetReadLimit(1<<20)
  _=p.ws.SetReadDeadline(time.Now().Add(45*time.Second))
  p.ws.SetPongHandler(func(string) error { return p.ws.SetReadDeadline(time.Now().Add(45*time.Second)) })
  p.pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState){
    if state==webrtc.PeerConnectionStateFailed || state==webrtc.PeerConnectionStateClosed { _=p.ws.Close() }
  })
  p.pc.OnTrack(func(track *webrtc.TrackRemote,_ *webrtc.RTPReceiver){
    if track.Kind()!=webrtc.RTPCodecTypeVideo && track.Kind()!=webrtc.RTPCodecTypeAudio { return }
    if p.role=="host" { addHostTrack(r,track); return }
    if p.role=="guest" { addGuestTrack(r,track) }
  })
  for {
    _=p.ws.SetReadDeadline(time.Now().Add(45*time.Second))
    var message signal
    if err:=p.ws.ReadJSON(&message);err!=nil{return}
    switch message.Type {
    case "offer":
      if err:=p.pc.SetRemoteDescription(webrtc.SessionDescription{Type:webrtc.SDPTypeOffer,SDP:message.SDP});err!=nil{return}
      if p.role=="viewer"{if err:=addTracksToViewer(p,r);err!=nil{return}}
      answer,err:=p.pc.CreateAnswer(nil);if err!=nil{return}
      if err=p.pc.SetLocalDescription(answer);err!=nil{return}
      <-webrtc.GatheringCompletePromise(p.pc)
      if local:=p.pc.LocalDescription();local!=nil{if err:=p.send(signal{Type:"answer",SDP:local.SDP});err!=nil{return}}
    case "answer":
      if err:=p.pc.SetRemoteDescription(webrtc.SessionDescription{Type:webrtc.SDPTypeAnswer,SDP:message.SDP});err!=nil{return}
    case "candidate":
      if message.Candidate!=nil{_ = p.pc.AddICECandidate(*message.Candidate)}
    }
  }
}

func connectionAllowed(ip string) bool {
  limit := envInt("MEDIA_ENGINE_CONNECTIONS_PER_MINUTE", 60)
  key := "rate:" + ip
  rateMu.Lock()
  defer rateMu.Unlock()
  entry := connectionRates[key]
  now := time.Now()
  if entry.started.IsZero() || now.Sub(entry.started) >= time.Minute {
    connectionRates[key] = rateEntry{started: now, count: 1}
    return true
  }
  if entry.count >= limit { return false }
  entry.count++
  connectionRates[key] = entry
  return true
}

func roomLimitReached(r *room, role string) bool {
  r.mu.Lock()
  defer r.mu.Unlock()
  if role == "viewer" && len(r.viewers) >= envInt("MEDIA_ENGINE_MAX_VIEWERS", 500) { return true }
  if role == "guest" && len(r.guests) >= envInt("MEDIA_ENGINE_MAX_GUESTS", 4) { return true }
  return false
}

func envInt(name string, fallback int) int {
  value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(name)))
  if err != nil || value <= 0 { return fallback }
  return value
}

func iceServers() []webrtc.ICEServer {
  servers:=[]webrtc.ICEServer{{URLs:[]string{"stun:stun.l.google.com:19302"}}}
  raw:=strings.TrimSpace(os.Getenv("MEDIA_ENGINE_ICE_SERVERS"))
  if raw=="" { return servers }
  var extra []webrtc.ICEServer
  if json.Unmarshal([]byte(raw),&extra)==nil { servers=append(servers,extra...) }
  return servers
}
func wsHandler(w http.ResponseWriter,req *http.Request){
  totalConnections.Add(1)
  secret:=os.Getenv("MEDIA_ENGINE_SECRET");if secret==""{http.Error(w,"media engine not configured",503);return}
  c,err:=verifyToken(req.URL.Query().Get("token"),secret);if err!=nil{rejectedConnections.Add(1);http.Error(w,"unauthorized",401);return}
  remoteIP,_,_:=net.SplitHostPort(req.RemoteAddr)
  if !connectionAllowed(remoteIP){rejectedConnections.Add(1);http.Error(w,"rate limited",429);return}
  conn,err:=upgrader.Upgrade(w,req,nil);if err!=nil{return}
  publicIP:=strings.TrimSpace(os.Getenv("MEDIA_ENGINE_PUBLIC_IP"))
  setting:=webrtc.SettingEngine{}
  _=setting.SetEphemeralUDPPortRange(10000,20000)
  setting.SetICEMulticastDNSMode(ice.MulticastDNSModeDisabled)
  if publicIP!=""{setting.SetNAT1To1IPs([]string{publicIP},webrtc.ICECandidateTypeHost)}
  media:=&webrtc.MediaEngine{};if err:=media.RegisterDefaultCodecs();err!=nil{_ = conn.Close();return}
  api:=webrtc.NewAPI(webrtc.WithSettingEngine(setting),webrtc.WithMediaEngine(media))
  pc,err:=api.NewPeerConnection(webrtc.Configuration{ICEServers:iceServers()})
  if err!=nil{_ = conn.Close();return}
  p:=&peer{ws:conn,pc:pc,role:c.Role};r:=getRoom(c.StreamID)
  if roomLimitReached(r,c.Role){rejectedConnections.Add(1);closePeer(p);return}
  r.mu.Lock()
  if c.Role=="host" {if r.host!=nil{r.mu.Unlock();closePeer(p);return};r.host=p} else if c.Role=="guest" {r.guests[p]=true} else {r.viewers[p]=true}
  r.mu.Unlock()
  broadcastPresence(r)
  go handlePeer(p,r)
}

func health(w http.ResponseWriter,_ *http.Request){
  rooms.Range(func(_,v any) bool { _ = v.(*room); return true })
  w.Header().Set("content-type","application/json")
  _,_=w.Write([]byte(`{"ok":true,"service":"testagram-media-engine","transport":"webrtc-sfu","features":["websocket-signaling","host-publish","viewer-subscribe","guest-ingress","stun","turn-config","rtp-forwarding","room-isolation"]}`))
}

func metrics(w http.ResponseWriter,_ *http.Request){
  w.Header().Set("content-type","text/plain; version=0.0.4")
  fmt.Fprintf(w,"testagram_media_connections_total %d\n",totalConnections.Load())
  fmt.Fprintf(w,"testagram_media_connections_rejected_total %d\n",rejectedConnections.Load())
  fmt.Fprintf(w,"testagram_media_rtp_packets_total %d\n",rtpPackets.Load())
  fmt.Fprintf(w,"testagram_media_rtp_write_errors_total %d\n",rtpWriteErrors.Load())
  roomsCount:=0
  rooms.Range(func(_, _ any) bool {roomsCount++;return true})
  fmt.Fprintf(w,"testagram_media_active_rooms %d\n",roomsCount)
}

func main(){mux:=http.NewServeMux();mux.HandleFunc("/healthz",health);mux.HandleFunc("/ws",wsHandler);port:=os.Getenv("PORT");if port==""{port="8080"};log.Printf("Testagram Media Engine listening on :%s",port);log.Fatal(http.ListenAndServe(":"+port,mux))}
