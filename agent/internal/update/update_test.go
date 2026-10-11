package update

import (
	"crypto/ed25519"
	"crypto/rand"
	"testing"
	"time"
)

func sign(t *testing.T, priv ed25519.PrivateKey, id string, p Payload) Manifest {
	t.Helper()
	m, err := Sign(p, id, priv)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return m
}

// Sign (release side) and Verify (agent side) must agree.
func TestSignRoundTrip(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	p := Payload{Version: "1.2.0", Date: time.Now().UTC(), Assets: map[string]Asset{
		"linux-amd64": {URL: "https://x/modfield-agent_linux_amd64", SHA256: "ab"},
	}}
	m, err := Sign(p, "k9", priv)
	if err != nil {
		t.Fatal(err)
	}
	got, err := Verify(m, map[string]ed25519.PublicKey{"k9": pub}, State{}, "1.1.0")
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if got.Version != "1.2.0" || got.Assets["linux-amd64"].URL == "" {
		t.Fatalf("payload round-trip wrong: %+v", got)
	}
}

func TestVerify(t *testing.T) {
	pub1, priv1, _ := ed25519.GenerateKey(rand.Reader)
	pub2, priv2, _ := ed25519.GenerateKey(rand.Reader)
	_, evil, _ := ed25519.GenerateKey(rand.Reader)
	keys, err := ParseKeyring("k1:" + b64.EncodeToString(pub1) + ",k2:" + b64.EncodeToString(pub2))
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	p := Payload{Version: "0.4.0", Date: now}

	if _, err := Verify(sign(t, priv1, "k1", p), keys, State{}, "0.3.0"); err != nil {
		t.Fatalf("valid manifest: %v", err)
	}
	if _, err := Verify(sign(t, evil, "k1", p), keys, State{}, "0.3.0"); err != ErrSignature {
		t.Fatalf("forged: %v", err)
	}
	if _, err := Verify(sign(t, priv1, "k9", p), keys, State{}, "0.3.0"); err != ErrSignature {
		t.Fatalf("unknown key: %v", err)
	}
	m := sign(t, priv1, "k1", p)
	m.Payload = sign(t, priv1, "k1", Payload{Version: "9.9.9", Date: now}).Payload
	if _, err := Verify(m, keys, State{}, "0.3.0"); err != ErrSignature {
		t.Fatalf("swapped payload: %v", err)
	}
	if _, err := Verify(sign(t, priv1, "k1", Payload{Version: "0.2.0", Date: now}), keys, State{}, "0.3.0"); err != ErrNotNewer {
		t.Fatalf("downgrade: %v", err)
	}
	if _, err := Verify(sign(t, priv1, "k1", p), keys, State{LastDate: now.Add(time.Hour)}, "0.3.0"); err != ErrOld {
		t.Fatalf("replayed old manifest: %v", err)
	}
	if _, err := Verify(sign(t, priv1, "k1", p), keys, State{RetiredKeys: []string{"k1"}}, "0.3.0"); err != ErrRetired {
		t.Fatalf("retired key: %v", err)
	}
	if _, err := Verify(sign(t, priv2, "k2", p), keys, State{RetiredKeys: []string{"k1"}}, "0.3.0"); err != nil {
		t.Fatalf("next key after rotation: %v", err)
	}
}

func TestCompare(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want int
	}{
		{"1.2.3", "1.2.3", 0}, {"1.2.10", "1.2.9", 1}, {"v2.0.0", "1.9.9", 1},
		{"1.0.0-rc1", "1.0.0", -1}, {"0.3.0", "0.3.0-dev", 1}, {"1.0.0-rc2", "1.0.0-rc1", 1},
	} {
		if got := Compare(c.a, c.b); got != c.want {
			t.Errorf("Compare(%s, %s) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}
