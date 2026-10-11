package identity

import (
	"crypto/rand"
	"crypto/subtle"
	"fmt"
	"math/big"
	"sync"
	"time"
)

// PairingTTL is how long a code stays valid.
const PairingTTL = 2 * time.Minute

// MaxAttempts guards the 6-digit code against guessing.
const MaxAttempts = 5

// MaxPending caps how many pairing requests can wait at once, so a hostile
// (or buggy) page cannot grow the map or spam the pairing pop-up without bound.
const MaxPending = 20

// Request is a pending pairing: the code is shown only on the agent's side
// (local page or terminal) and the user types it into the site.
type Request struct {
	ID       string    `json:"id"`
	Code     string    `json:"code"`
	Name     string    `json:"name"`
	Origin   string    `json:"origin"`
	Expires  time.Time `json:"expires"`
	attempts int
}

// Pairing holds pending requests.
type Pairing struct {
	mu   sync.Mutex
	reqs map[string]*Request
	// FixedCode is only for tests (--test-pairing-code with --dev).
	FixedCode string
	now       func() time.Time
}

// NewPairing returns an empty set of requests.
func NewPairing() *Pairing { return &Pairing{reqs: map[string]*Request{}, now: time.Now} }

// Begin creates a request for a browser. Each call gets its own code, so two
// browsers can pair at once, but the total is capped (ErrTooMany past
// MaxPending) so a loop cannot grow the map without bound. fresh is false when
// a request for this origin is already pending, letting the caller skip
// re-opening the pairing page on repeated calls (pop-up rate limit).
func (p *Pairing) Begin(name, origin string) (r *Request, fresh bool, err error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.gc()
	if len(p.reqs) >= MaxPending {
		return nil, false, ErrTooMany
	}
	fresh = true
	for _, ex := range p.reqs {
		if ex.Origin == origin {
			fresh = false
			break
		}
	}
	code := p.FixedCode
	if code == "" {
		n, _ := rand.Int(rand.Reader, big.NewInt(1_000_000))
		code = fmt.Sprintf("%06d", n.Int64())
	}
	r = &Request{ID: Nonce()[:16], Code: code, Name: name, Origin: origin, Expires: p.now().Add(PairingTTL)}
	p.reqs[r.ID] = r
	return r, fresh, nil
}

// ErrBadCode and friends are returned by Complete.
var (
	ErrBadCode     = fmt.Errorf("wrong code")
	ErrExpired     = fmt.Errorf("pairing request expired")
	ErrTooMany     = fmt.Errorf("too many attempts")
	ErrWrongOrigin = fmt.Errorf("pairing started from another origin")
)

// Complete checks the code typed by the user.
func (p *Pairing) Complete(id, code, origin string) (*Request, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	r := p.reqs[id]
	if r == nil || p.now().After(r.Expires) {
		delete(p.reqs, id)
		return nil, ErrExpired
	}
	if r.Origin != origin {
		return nil, ErrWrongOrigin
	}
	if subtle.ConstantTimeCompare([]byte(r.Code), []byte(code)) != 1 {
		r.attempts++
		if r.attempts >= MaxAttempts {
			delete(p.reqs, id)
			return nil, ErrTooMany
		}
		return nil, ErrBadCode
	}
	delete(p.reqs, id)
	return r, nil
}

// Pending lists live requests (for the local /pair page and the CLI).
func (p *Pairing) Pending() []Request {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.gc()
	out := make([]Request, 0, len(p.reqs))
	for _, r := range p.reqs {
		out = append(out, *r)
	}
	return out
}

func (p *Pairing) gc() {
	for id, r := range p.reqs {
		if p.now().After(r.Expires) {
			delete(p.reqs, id)
		}
	}
}
