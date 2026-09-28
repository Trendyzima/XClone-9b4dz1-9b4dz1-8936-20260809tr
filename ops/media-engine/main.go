package main

import (
  "crypto/hmac"
  "crypto/sha256"
  "encoding/base64"
  "encoding/json"
  "errors"
  "log"
  "net/http"
  "os"
  "strconv"
  "strings"
  "sync"
  "time"

  "github.com/gorilla/websocket"
  "github.com/pion/rtp"
  "github.com/pion/webrtc/v4"
)

type tokenPayload struct {
  Role string `json:"role"`
  StreamID string `json:"stream_id"`
  UserID string `json:"user_id"`
  Exp int64 `json:"exp"`
}

func verifyToken(raw, secret string) (*tokenPayload,error) {
  parts:=strings.Split(raw,"."); if len(parts)!=3{return nil,errors.New("invalid token")}
  header,err:=base64.RawURLEncoding.DecodeString(parts[0]);if err!=nil||string(header)!="testagram-media-v1"{return nil,errors.New("invalid token header")}
  payload,err:=base64.RawURLEncoding.DecodeString(parts[1]);if err!=nil{return nil,errors.New("invalid payload")}
  sig,err:=base64.RawURLEncoding.DecodeString(parts[2]);if err!=nil{return nil,errors.New("invalid signature")}
  mac:=hmac.New(sha256.New,[]byte(secret));_,_=mac.Write([]byte(parts[1]));if !hmac.Equal(sig,mac.Sum(nil)){return nil,errors.New("bad signature")}
  var p tokenPayload;if err=json.Unmarshal(payload,&p);err!=nil{return nil,err}
  if p.StreamID==""||p.Exp<=time.Now().Unix(){return nil,errors.New("expired token")}
  if p.Role!="host"&&p.Role!="guest"&&p.Role!="viewer"{return nil,errors.New("invalid role")}
  return &p,nil
}

type signalMessage struct {
  Type string `json:"type"`
  SDP string `json:"sdp,omitempty"`
  Candidate *webrtc.ICECandidateInit `json:"candidate,omitempty"`
  ViewerCount int `json:"viewer_count,omitempty"`
  GuestCount int `json:"guest_count,omitempty"`
}
type peer struct { ws *websocket.Conn; pc *webrtc.PeerConnection; role string; room *room; writeMu sync.Mutex }
func (p *peer) send(m signalMessage)error{p.writeMu.Lock();defer p.writeMu.Unlock();return p.ws.WriteJSON(m)}
type room struct { mu sync.Mutex; id string; peers map[*peer]struct{}; tracks map[string]*webrtc.TrackLocalStaticRTP }
var roomsMu sync.Mutex
var rooms=map[string]*room{}
func getRoom(id string)*room{roomsMu.Lock();defer roomsMu.Unlock();if r:=rooms[id];r!=nil{return r};r:=&room{id:id,peers:map[*peer]struct{}{},tracks:map[string]*webrtc.TrackLocalStaticRTP{}};rooms[id]=r;return r}
func (r *room) counts()(int,int){r.mu.Lock();defer r.mu.Unlock();v,g:=0,0;for p:=range r.peers{if p.role=="viewer"{v++};if p.role=="guest"{g++}};return v,g}
func (r *room) presence(){v,g:=r.counts();r.mu.Lock();peers:=make([]*peer,0,len(r.peers));for p:=range r.peers{peers=append(peers,p)};r.mu.Unlock();for _,p:=range peers{_=p.send(signalMessage{Type:"presence",ViewerCount:v,GuestCount:g})}}
func (r *room) addTrack(t *webrtc.TrackRemote)(*webrtc.TrackLocalStaticRTP,error){local,err:=webrtc.NewTrackLocalStaticRTP(t.Codec().RTPCodecCapability,t.ID(),t.StreamID());if err!=nil{return nil,err};r.mu.Lock();r.tracks[t.ID()]=local;peers:=make([]*peer,0,len(r.peers));for p:=range r.peers{peers=append(peers,p)};r.mu.Unlock();go r.renegotiate(peers);return local,nil}
func (r *room) removeTrack(id string){r.mu.Lock();delete(r.tracks,id);peers:=make([]*peer,0,len(r.peers));for p:=range r.peers{peers=append(peers,p)};r.mu.Unlock();go r.renegotiate(peers)}
func (r *room) renegotiate(peers []*peer){for _,p:=range peers{if p.pc.ConnectionState()==webrtc.PeerConnectionStateClosed{continue};r.mu.Lock();tracks:=make([]*webrtc.TrackLocalStaticRTP,0,len(r.tracks));for _,t:=range r.tracks{tracks=append(tracks,t)};r.mu.Unlock();existing:=map[string]bool{};for _,s:=range p.pc.GetSenders(){if s.Track()!=nil{existing[s.Track().ID()]=true}};for _,t:=range tracks{if !existing[t.ID()]{_,_=p.pc.AddTrack(t)}};offer,err:=p.pc.CreateOffer(nil);if err!=nil{continue};if err=p.pc.SetLocalDescription(offer);err!=nil{continue};_=p.send(signalMessage{Type:"offer",SDP:offer.SDP})}}
func (r *room) removePeer(p *peer){r.mu.Lock();delete(r.peers,p);r.mu.Unlock();_=p.pc.Close();r.presence()}

func newPeerConnection()(*webrtc.PeerConnection,error){
  servers:=[]webrtc.ICEServer{}
  if u:=strings.TrimSpace(os.Getenv("MEDIA_STUN_URL"));u!=""{servers=append(servers,webrtc.ICEServer{URLs:[]string{u}})}
  if u,user,cred:=strings.TrimSpace(os.Getenv("MEDIA_TURN_URL")),os.Getenv("MEDIA_TURN_USERNAME"),os.Getenv("MEDIA_TURN_CREDENTIAL");u!=""&&user!=""&&cred!=""{servers=append(servers,webrtc.ICEServer{URLs:[]string{u},Username:user,Credential:cred})}
  se:=webrtc.SettingEngine{}
  if ip:=strings.TrimSpace(os.Getenv("MEDIA_PUBLIC_IP"));ip!=""{se.SetNAT1To1IPs([]string{ip},webrtc.ICECandidateTypeHost)}
  if a,b:=os.Getenv("MEDIA_UDP_PORT_MIN"),os.Getenv("MEDIA_UDP_PORT_MAX");a!=""&&b!=""{min,_:=strconv.ParseUint(a,10,16);max,_:=strconv.ParseUint(b,10,16);if min>0&&max>=min{if err:=se.SetEphemeralUDPPortRange(uint16(min),uint16(max));err!=nil{return nil,err}}}
  return webrtc.NewAPI(webrtc.WithSettingEngine(se)).NewPeerConnection(webrtc.Configuration{ICEServers:servers})
}

func handlePeer(w http.ResponseWriter,rq *http.Request){
  secret:=os.Getenv("MEDIA_ENGINE_SECRET");if secret==""{http.Error(w,"engine not configured",503);return}
  token:=rq.URL.Query().Get("token");pld,err:=verifyToken(token,secret);if err!=nil{http.Error(w,"unauthorized",401);return}
  if rq.URL.Path!="/ws"{http.NotFound(w,rq);return}
  ws,err:=(&websocket.Upgrader{CheckOrigin:func(_ *http.Request)bool{return true}}).Upgrade(w,rq,nil);if err!=nil{return}
  pc,err:=newPeerConnection();if err!=nil{_=ws.Close();return}
  room:=getRoom(pld.StreamID);p:=&peer{ws:ws,pc:pc,role:pld.Role,room:room};room.mu.Lock();room.peers[p]=struct{}{};room.mu.Unlock();defer room.removePeer(p);defer ws.Close()
  for _,kind:=range []webrtc.RTPCodecType{webrtc.RTPCodecTypeVideo,webrtc.RTPCodecTypeAudio}{if _,err:=pc.AddTransceiverFromKind(kind,webrtc.RTPTransceiverInit{Direction:webrtc.RTPTransceiverDirectionRecvonly});err!=nil{return}}
  pc.OnICECandidate(func(c *webrtc.ICECandidate){if c!=nil{v:=c.ToJSON();_=p.send(signalMessage{Type:"candidate",Candidate:&v})}})
  pc.OnConnectionStateChange(func(s webrtc.PeerConnectionState){if s==webrtc.PeerConnectionStateFailed{_=pc.Close()}})
  pc.OnTrack(func(t *webrtc.TrackRemote,_ *webrtc.RTPReceiver){if p.role!="host"&&p.role!="guest"{return};local,err:=room.addTrack(t);if err!=nil{return};defer room.removeTrack(t.ID());buf:=make([]byte,2000);pkt:=&rtp.Packet{};for{n,_,e:=t.Read(buf);if e!=nil{return};if e=pkt.Unmarshal(buf[:n]);e!=nil{return};pkt.Extension=false;pkt.Extensions=nil;if e=local.WriteRTP(pkt);e!=nil{return}}})
  room.presence()
  for{var msg signalMessage;if err:=ws.ReadJSON(&msg);err!=nil{return};switch msg.Type{
  case "candidate":if msg.Candidate!=nil{_=pc.AddICECandidate(*msg.Candidate)}
  case "offer":offer:=webrtc.SessionDescription{Type:webrtc.SDPTypeOffer,SDP:msg.SDP};if err:=pc.SetRemoteDescription(offer);err!=nil{return};room.mu.Lock();tracks:=make([]*webrtc.TrackLocalStaticRTP,0,len(room.tracks));for _,t:=range room.tracks{tracks=append(tracks,t)};room.mu.Unlock();existing:=map[string]bool{};for _,s:=range pc.GetSenders(){if s.Track()!=nil{existing[s.Track().ID()]=true}};for _,t:=range tracks{if !existing[t.ID()]{_,_=pc.AddTrack(t)}};answer,err:=pc.CreateAnswer(nil);if err!=nil{return};if err=pc.SetLocalDescription(answer);err!=nil{return};if err=p.send(signalMessage{Type:"answer",SDP:answer.SDP});err!=nil{return}
  case "answer":answer:=webrtc.SessionDescription{Type:webrtc.SDPTypeAnswer,SDP:msg.SDP};if err:=pc.SetRemoteDescription(answer);err!=nil{return}
  }}
}

func health(w http.ResponseWriter,_ *http.Request){w.Header().Set("Content-Type","application/json");_,_=w.Write([]byte("{\"ok\":true,\"service\":\"testagram-media-engine\",\"protocol\":\"testagram-media-v1\",\"webrtc\":true}"))}
func main(){if os.Getenv("MEDIA_ENGINE_SECRET")==""{log.Fatal("MEDIA_ENGINE_SECRET is required")};mux:=http.NewServeMux();mux.HandleFunc("/health",health);mux.HandleFunc("/ws",handlePeer);addr:=os.Getenv("MEDIA_HTTP_ADDR");if addr==""{addr=":8080"};log.Printf("Testagram Media Engine listening on %s",addr);log.Fatal(http.ListenAndServe(addr,mux))}
