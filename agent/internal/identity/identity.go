// Package identity holds the agent's Ed25519 key and the paired browsers.
//
// Mutual authentication, so neither side trusts a name or a port:
//  1. The browser sends a random nonce; the agent signs
//     "modfield-agent-auth:v1:<origin>:<browserNonce>:<agentNonce>" and
//     returns the signature with its own nonce. The browser checks it with
//     the public key it pinned at pairing time. A process squatting on the
//     port cannot produce it.
//  2. The browser proves its token without sending it: HMAC-SHA256(secret,
//     "modfield-browser-auth:v1:<agentNonce>:<browserNonce>").
package identity

import (
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

var b64 = base64.RawURLEncoding

// Browser is one paired browser.
type Browser struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	Origin   string    `json:"origin"`
	Secret   string    `json:"secret"` // base64url, 32 bytes
	Created  time.Time `json:"created"`
	LastSeen time.Time `json:"lastSeen"`
}

// Store persists the key and tokens in the user's data directory (mode 0600).
type Store struct {
	dir  string
	mu   sync.Mutex
	key  ed25519.PrivateKey
	list []Browser
}

// Open loads or creates the identity in dir.
func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	s := &Store{dir: dir}
	keyPath := filepath.Join(dir, "agent.key")
	if raw, err := os.ReadFile(keyPath); err == nil {
		seed, err := b64.DecodeString(string(raw))
		if err != nil || len(seed) != ed25519.SeedSize {
			return nil, fmt.Errorf("%s is corrupt", keyPath)
		}
		s.key = ed25519.NewKeyFromSeed(seed)
	} else if errors.Is(err, os.ErrNotExist) {
		_, priv, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return nil, err
		}
		s.key = priv
		if err := os.WriteFile(keyPath, []byte(b64.EncodeToString(priv.Seed())), 0o600); err != nil {
			return nil, err
		}
	} else {
		return nil, err
	}
	if raw, err := os.ReadFile(filepath.Join(dir, "browsers.json")); err == nil {
		if err := json.Unmarshal(raw, &s.list); err != nil {
			return nil, fmt.Errorf("browsers.json is corrupt: %w", err)
		}
	}
	return s, nil
}

// PublicKey is the agent's public key, base64url.
func (s *Store) PublicKey() string { return b64.EncodeToString(s.key.Public().(ed25519.PublicKey)) }

// Fingerprint is a short, human-comparable form of the public key.
func (s *Store) Fingerprint() string {
	sum := sha256.Sum256(s.key.Public().(ed25519.PublicKey))
	return fmt.Sprintf("%X", sum[:6])
}

// Sign signs msg with the agent key; the browser verifies it with the pinned key.
func (s *Store) Sign(msg []byte) []byte { return ed25519.Sign(s.key, msg) }

// AgentAuthMessage is what the agent signs to prove its identity.
func AgentAuthMessage(origin, browserNonce, agentNonce string) []byte {
	return []byte("modfield-agent-auth:v1:" + origin + ":" + browserNonce + ":" + agentNonce)
}

// BrowserAuthMessage is what the browser MACs with its token secret.
func BrowserAuthMessage(agentNonce, browserNonce string) []byte {
	return []byte("modfield-browser-auth:v1:" + agentNonce + ":" + browserNonce)
}

// Nonce returns 32 random bytes, base64url.
func Nonce() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return b64.EncodeToString(b)
}

func (s *Store) save() error {
	raw, err := json.MarshalIndent(s.list, "", "  ")
	if err != nil {
		return err
	}
	tmp := filepath.Join(s.dir, "browsers.json.tmp")
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(s.dir, "browsers.json"))
}

// Add pairs a browser and returns it with its new secret.
func (s *Store) Add(name, origin string) (Browser, error) {
	secret := make([]byte, 32)
	id := make([]byte, 9)
	_, _ = rand.Read(secret)
	_, _ = rand.Read(id)
	b := Browser{ID: b64.EncodeToString(id), Name: name, Origin: origin, Secret: b64.EncodeToString(secret), Created: time.Now().UTC()}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.list = append(s.list, b)
	return b, s.save()
}

// Verify checks a browser's MAC. The origin must match the one it paired from.
func (s *Store) Verify(id, origin, agentNonce, browserNonce, mac string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.list {
		b := &s.list[i]
		if subtle.ConstantTimeCompare([]byte(b.ID), []byte(id)) != 1 || b.Origin != origin {
			continue
		}
		secret, err := b64.DecodeString(b.Secret)
		if err != nil {
			return false
		}
		want := hmac.New(sha256.New, secret)
		want.Write(BrowserAuthMessage(agentNonce, browserNonce))
		got, err := b64.DecodeString(mac)
		if err != nil || !hmac.Equal(want.Sum(nil), got) {
			return false
		}
		b.LastSeen = time.Now().UTC()
		_ = s.save()
		return true
	}
	return false
}

// List returns the paired browsers without their secrets.
func (s *Store) List() []Browser {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Browser, len(s.list))
	for i, b := range s.list {
		b.Secret = ""
		out[i] = b
	}
	return out
}

// Revoke removes a browser; its open sessions are closed by the caller.
func (s *Store) Revoke(id string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, b := range s.list {
		if b.ID == id {
			s.list = append(s.list[:i], s.list[i+1:]...)
			return true, s.save()
		}
	}
	return false, nil
}
