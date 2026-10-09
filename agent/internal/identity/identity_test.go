package identity

import (
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/sha256"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestKeyPersistsAndSigns(t *testing.T) {
	dir := t.TempDir()
	a, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	b, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if a.PublicKey() != b.PublicKey() {
		t.Fatal("key changed across restarts")
	}
	st, _ := os.Stat(filepath.Join(dir, "agent.key"))
	if st.Mode().Perm() != 0o600 {
		t.Fatalf("key file mode %v", st.Mode().Perm())
	}
	pub, _ := b64.DecodeString(a.PublicKey())
	msg := AgentAuthMessage("https://x", "n1", "n2")
	if !ed25519.Verify(pub, msg, a.Sign(msg)) {
		t.Fatal("signature does not verify")
	}
}

func TestBrowserAuth(t *testing.T) {
	s, _ := Open(t.TempDir())
	br, _ := s.Add("Chrome", "https://modfield.app")
	secret, _ := b64.DecodeString(br.Secret)
	mac := hmac.New(sha256.New, secret)
	mac.Write(BrowserAuthMessage("an", "bn"))
	good := b64.EncodeToString(mac.Sum(nil))

	if !s.Verify(br.ID, "https://modfield.app", "an", "bn", good) {
		t.Fatal("valid MAC rejected")
	}
	if s.Verify(br.ID, "https://evil.example", "an", "bn", good) {
		t.Fatal("MAC accepted from another origin")
	}
	if s.Verify(br.ID, "https://modfield.app", "other", "bn", good) {
		t.Fatal("replayed MAC accepted for another nonce")
	}
	if s.List()[0].Secret != "" {
		t.Fatal("List leaks secrets")
	}
	if ok, _ := s.Revoke(br.ID); !ok || s.Verify(br.ID, "https://modfield.app", "an", "bn", good) {
		t.Fatal("revoked token still valid")
	}
}

func TestPairing(t *testing.T) {
	p := NewPairing()
	r := p.Begin("Chrome", "https://o")
	if len(r.Code) != 6 {
		t.Fatalf("code %q", r.Code)
	}
	if _, err := p.Complete(r.ID, r.Code, "https://other"); err != ErrWrongOrigin {
		t.Fatalf("origin: %v", err)
	}
	for i := 0; i < MaxAttempts-1; i++ {
		if _, err := p.Complete(r.ID, "000000x", "https://o"); err != ErrBadCode {
			t.Fatalf("attempt %d: %v", i, err)
		}
	}
	if _, err := p.Complete(r.ID, "nope", "https://o"); err != ErrTooMany {
		t.Fatalf("lockout: %v", err)
	}

	clock := time.Now()
	p.now = func() time.Time { return clock }
	r = p.Begin("Firefox", "https://o")
	clock = clock.Add(PairingTTL + time.Second)
	if _, err := p.Complete(r.ID, r.Code, "https://o"); err != ErrExpired {
		t.Fatalf("expiry: %v", err)
	}
}
