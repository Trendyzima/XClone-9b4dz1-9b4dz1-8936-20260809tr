package main

import (
  "crypto/hmac"
  "crypto/sha256"
  "encoding/base64"
  "encoding/json"
  "net/http/httptest"
  "os"
  "testing"
  "time"
)

func testToken(t *testing.T, mode, role, room string, exp int64, secret string) string {
  t.Helper()
  enc := func(v []byte) string { return base64.RawURLEncoding.EncodeToString(v) }
  h := enc([]byte("testagram-media-v1"))
  p, _ := json.Marshal(claims{Mode: mode, RoomID: room, Role: role, UserID: "user-1", Exp: exp})
  payload := enc(p)
  mac := hmac.New(sha256.New, []byte(secret))
  _, _ = mac.Write(p)
  return h + "." + payload + "." + enc(mac.Sum(nil))
}

func TestVerifyTokenAcceptsNativeModes(t *testing.T) {
  for _, tc := range []struct{ mode, role string }{
    {"tv", "host"}, {"tv", "viewer"}, {"tv", "guest"},
    {"space", "host"}, {"space", "listener"}, {"space", "speaker"},
    {"call", "participant"},
  } {
    token := testToken(t, tc.mode, tc.role, "room-1", time.Now().Add(time.Minute).Unix(), "secret")
    got, err := verifyToken(token, "secret")
    if err != nil { t.Fatalf("%s/%s rejected: %v", tc.mode, tc.role, err) }
    if got.Mode != tc.mode || got.Role != tc.role || got.RoomID != "room-1" { t.Fatalf("unexpected claims: %#v", got) }
  }
}

func TestVerifyTokenRejectsTamperingAndExpiry(t *testing.T) {
  valid := testToken(t, "call", "participant", "room-1", time.Now().Add(time.Minute).Unix(), "secret")
  parts := []byte(valid)
  parts[len(parts)-2] ^= 1
  if _, err := verifyToken(string(parts), "secret"); err == nil { t.Fatal("tampered token was accepted") }

  expired := testToken(t, "tv", "viewer", "room-1", time.Now().Add(-time.Minute).Unix(), "secret")
  if _, err := verifyToken(expired, "secret"); err == nil { t.Fatal("expired token was accepted") }
}

func TestVerifyTokenRejectsUnknownRoleAndMode(t *testing.T) {
  badRole := testToken(t, "call", "admin", "room-1", time.Now().Add(time.Minute).Unix(), "secret")
  if _, err := verifyToken(badRole, "secret"); err == nil { t.Fatal("unknown call role was accepted") }
  badMode := testToken(t, "unknown", "participant", "room-1", time.Now().Add(time.Minute).Unix(), "secret")
  if _, err := verifyToken(badMode, "secret"); err == nil { t.Fatal("unknown mode was accepted") }
}

func TestAllowedOrigin(t *testing.T) {
  previous := os.Getenv("MEDIA_ENGINE_ALLOWED_ORIGINS")
  t.Cleanup(func() { _ = os.Setenv("MEDIA_ENGINE_ALLOWED_ORIGINS", previous) })
  _ = os.Setenv("MEDIA_ENGINE_ALLOWED_ORIGINS", "https://testagram.example,https://studio.testagram.example")
  allowed := httptest.NewRequest("GET", "https://media.testagram.example/ws", nil)
  allowed.Header.Set("Origin", "https://studio.testagram.example")
  if !checkOrigin(allowed) { t.Fatal("configured origin was rejected") }
  denied := httptest.NewRequest("GET", "https://media.testagram.example/ws", nil)
  denied.Header.Set("Origin", "https://evil.example")
  if checkOrigin(denied) { t.Fatal("unconfigured origin was accepted") }
}
