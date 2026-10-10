// Package agent is the agent's state and its JSON-RPC methods. Transport
// (HTTP, WebSocket, origin checks, local pages) lives in internal/server.
package agent

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"modfield.dev/agent/internal/identity"
	"modfield.dev/agent/internal/logstore"
	"modfield.dev/agent/internal/modbus"
)

// Features advertised in agent.hello; the site hides what is missing.
var Features = []string{"rtu", "tcp", "poll", "scan.ids", "scan.ip", "sim.tcp", "sim.rtu", "traffic", "log", "report.sign"}

// leaseGrace keeps a connection open briefly after its last session leaves, so a page reload reuses it.
const leaseGrace = 15 * time.Second

// Agent is the running agent.
type Agent struct {
	Version  string
	ID       *identity.Store
	Pairing  *identity.Pairing
	Log      *slog.Logger
	// OpenURL opens a page in the user's default browser (the pairing page).
	OpenURL func(url string)
	// BaseURL is where the agent serves its pages, e.g. http://127.0.0.1:47807.
	BaseURL string
	// Logs is the data logger's disk buffer (nil disables log.*).
	Logs *logstore.Store
	// DataDir is checked for free space while logging.
	DataDir string

	mu       sync.Mutex
	conns    map[string]*Conn
	sessions map[*Session]bool
	polls    map[string]*poll
	scans    map[string]context.CancelFunc
	sims     map[string]*simRun
	loggers  map[string]*logger
	paused   bool
}

// New builds an agent.
func New(version string, id *identity.Store, log *slog.Logger) *Agent {
	return &Agent{
		Version: version, ID: id, Pairing: identity.NewPairing(), Log: log,
		conns: map[string]*Conn{}, sessions: map[*Session]bool{}, polls: map[string]*poll{},
		scans: map[string]context.CancelFunc{}, sims: map[string]*simRun{}, loggers: map[string]*logger{},
	}
}

func newID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// Session is one browser tab connected over WebSocket.
type Session struct {
	Origin string
	send   func(v any)

	mu           sync.Mutex
	browserID    string // set once authenticated
	agentNonce   string
	browserNonce string
	usedTokens   map[string]bool
	closed       bool
}

// NewSession registers a session; send must be safe for concurrent use.
func (a *Agent) NewSession(origin string, send func(v any)) *Session {
	s := &Session{Origin: origin, send: send, usedTokens: map[string]bool{}}
	a.mu.Lock()
	a.sessions[s] = true
	a.mu.Unlock()
	return s
}

// Authenticated reports whether the session proved its token.
func (s *Session) Authenticated() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.browserID != ""
}

func (s *Session) notify(method string, params any) {
	s.mu.Lock()
	closed := s.closed
	s.mu.Unlock()
	if !closed {
		s.send(rpcNotification{JSONRPC: "2.0", Method: method, Params: params})
	}
}

// EndSession releases what the session held: taps, leases and its polls.
func (a *Agent) EndSession(s *Session) {
	s.mu.Lock()
	s.closed = true
	s.mu.Unlock()
	a.mu.Lock()
	delete(a.sessions, s)
	var polls []*poll
	for _, p := range a.polls {
		if p.owner == s {
			polls = append(polls, p)
		}
	}
	conns := make([]*Conn, 0, len(a.conns))
	for _, c := range a.conns {
		conns = append(conns, c)
	}
	a.mu.Unlock()
	for _, p := range polls {
		a.stopPoll(p.id)
	}
	a.mu.Lock()
	for _, l := range a.loggers {
		l.unsubscribe(s)
	}
	a.mu.Unlock()
	for _, c := range conns {
		c.mu.Lock()
		delete(c.taps, s)
		delete(c.leases, s)
		c.mu.Unlock()
		a.maybeClose(c)
	}
}

// RevokeBrowser removes a token and closes its sessions.
func (a *Agent) RevokeBrowser(id string) error {
	if _, err := a.ID.Revoke(id); err != nil {
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	for s := range a.sessions {
		s.mu.Lock()
		if s.browserID == id {
			s.browserID = ""
			s.closed = true
		}
		s.mu.Unlock()
	}
	return nil
}

// SetPaused stops serving browsers while true (tray "Pausar").
func (a *Agent) SetPaused(p bool) {
	a.mu.Lock()
	a.paused = p
	a.mu.Unlock()
	if p {
		a.mu.Lock()
		ss := make([]*Session, 0, len(a.sessions))
		for s := range a.sessions {
			ss = append(ss, s)
		}
		a.mu.Unlock()
		for _, s := range ss {
			a.EndSession(s)
		}
	}
}

// Paused reports the tray state.
func (a *Agent) Paused() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.paused
}

// Status is a summary for the tray and the local pages.
func (a *Agent) Status() (sessions, conns, polls int) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return len(a.sessions), len(a.conns), len(a.polls)
}

// Handle runs one JSON-RPC message from a session and returns the response (nil for notifications).
func (a *Agent) Handle(s *Session, raw []byte) any {
	var req rpcRequest
	if err := json.Unmarshal(raw, &req); err != nil || req.JSONRPC != "2.0" || req.Method == "" {
		return rpcResponse{JSONRPC: "2.0", Error: &rpcError{Code: codeParse, Message: "invalid JSON-RPC message"}}
	}
	result, err := a.dispatch(s, req.Method, req.Params)
	if req.ID == nil {
		return nil
	}
	if err != nil {
		var re *rpcError
		if e, ok := err.(*rpcErrorValue); ok {
			re = e.e
		} else {
			re = toRPCError(err)
		}
		return rpcResponse{JSONRPC: "2.0", ID: *req.ID, Error: re}
	}
	if result == nil {
		result = struct{}{}
	}
	return rpcResponse{JSONRPC: "2.0", ID: *req.ID, Result: result}
}

type rpcErrorValue struct{ e *rpcError }

func (e *rpcErrorValue) Error() string { return e.e.Message }

var errNotPaired = &rpcErrorValue{&rpcError{Code: codeNotPaired, Message: "browser not paired or not authenticated", Data: errorData{Error: modbus.ErrNotPaired}}}

func decode[T any](raw json.RawMessage) (T, error) {
	var v T
	if len(raw) == 0 {
		return v, nil
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		return v, badParams(err.Error())
	}
	return v, nil
}

func (a *Agent) dispatch(s *Session, method string, raw json.RawMessage) (any, error) {
	// Methods open to anyone whose origin passed the check.
	switch method {
	case "agent.hello":
		return a.hello(), nil
	case "agent.challenge":
		return a.challenge(s, raw)
	case "agent.auth":
		return a.auth(s, raw)
	case "pair.begin":
		return a.pairBegin(s, raw)
	case "pair.complete":
		return a.pairComplete(s, raw)
	}
	if !s.Authenticated() {
		return nil, errNotPaired
	}
	switch method {
	case "serial.list":
		return listSerial()
	case "conn.open":
		return a.connOpen(s, raw)
	case "conn.close":
		return a.connClose(s, raw)
	case "conn.list":
		return a.connList(), nil
	case "conn.stats":
		return a.connStats(raw)
	case "modbus.read":
		return a.modbusRequest(s, raw, false)
	case "modbus.write":
		return a.modbusRequest(s, raw, true)
	case "traffic.subscribe":
		return a.trafficSubscribe(s, raw, true)
	case "traffic.unsubscribe":
		return a.trafficSubscribe(s, raw, false)
	case "poll.start":
		return a.pollStart(s, raw)
	case "poll.stop":
		p, err := decode[struct{ PollID string `json:"pollId"` }](raw)
		if err != nil {
			return nil, err
		}
		a.stopPoll(p.PollID)
		return nil, nil
	case "scan.start":
		return a.scanStart(s, raw)
	case "scan.stop":
		p, err := decode[struct{ ScanID string `json:"scanId"` }](raw)
		if err != nil {
			return nil, err
		}
		a.mu.Lock()
		if cancel := a.scans[p.ScanID]; cancel != nil {
			cancel()
		}
		a.mu.Unlock()
		return nil, nil
	case "sim.start":
		return a.simStart(s, raw)
	case "sim.stop":
		return a.simStop(raw)
	case "sim.list":
		return a.simList(), nil
	case "log.start", "log.stop", "log.list", "log.fetch", "log.ack", "log.subscribe", "log.delete":
		return a.logMethod(s, method, raw)
	case "report.sign":
		return a.reportSign(raw)
	}
	return nil, &rpcErrorValue{&rpcError{Code: codeMethod, Message: "unknown method " + method}}
}

// Hello is agent.hello.
type Hello struct {
	AgentVersion string         `json:"agentVersion"`
	Protocol     map[string]int `json:"protocol"`
	Features     []string       `json:"features"`
	PublicKey    string         `json:"publicKey"`
	Fingerprint  string         `json:"fingerprint"`
}

func (a *Agent) hello() Hello {
	return Hello{
		AgentVersion: a.Version,
		Protocol:     map[string]int{"major": ProtocolMajor, "minor": ProtocolMinor},
		Features:     Features,
		PublicKey:    a.ID.PublicKey(),
		Fingerprint:  a.ID.Fingerprint(),
	}
}

func (a *Agent) challenge(s *Session, raw json.RawMessage) (any, error) {
	p, err := decode[struct{ Nonce string `json:"nonce"` }](raw)
	if err != nil {
		return nil, err
	}
	if len(p.Nonce) < 16 || len(p.Nonce) > 128 {
		return nil, badParams("nonce must be 16..128 chars")
	}
	agentNonce := identity.Nonce()
	s.mu.Lock()
	s.agentNonce, s.browserNonce = agentNonce, p.Nonce
	s.mu.Unlock()
	sig := a.ID.Sign(identity.AgentAuthMessage(s.Origin, p.Nonce, agentNonce))
	return map[string]string{"agentNonce": agentNonce, "signature": base64.RawURLEncoding.EncodeToString(sig)}, nil
}

func (a *Agent) auth(s *Session, raw json.RawMessage) (any, error) {
	p, err := decode[struct {
		TokenID string `json:"tokenId"`
		MAC     string `json:"mac"`
	}](raw)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	agentNonce, browserNonce := s.agentNonce, s.browserNonce
	// A challenge is good for one attempt.
	s.agentNonce = ""
	s.mu.Unlock()
	if agentNonce == "" || !a.ID.Verify(p.TokenID, s.Origin, agentNonce, browserNonce, p.MAC) {
		return nil, errNotPaired
	}
	s.mu.Lock()
	s.browserID = p.TokenID
	s.mu.Unlock()
	return map[string]bool{"ok": true}, nil
}

func (a *Agent) pairBegin(s *Session, raw json.RawMessage) (any, error) {
	p, err := decode[struct{ Name string `json:"name"` }](raw)
	if err != nil {
		return nil, err
	}
	name := p.Name
	if len(name) > 80 {
		name = name[:80]
	}
	r := a.Pairing.Begin(name, s.Origin)
	a.Log.Info("pairing requested", "origin", s.Origin, "name", name, "code", r.Code)
	if a.OpenURL != nil {
		a.OpenURL(a.BaseURL + "/pair")
	}
	return map[string]any{"requestId": r.ID, "expires": r.Expires, "pairUrl": a.BaseURL + "/pair"}, nil
}

func (a *Agent) pairComplete(s *Session, raw json.RawMessage) (any, error) {
	p, err := decode[struct {
		RequestID string `json:"requestId"`
		Code      string `json:"code"`
	}](raw)
	if err != nil {
		return nil, err
	}
	r, err := a.Pairing.Complete(p.RequestID, p.Code, s.Origin)
	if err != nil {
		return nil, &rpcErrorValue{&rpcError{Code: codeNotPaired, Message: err.Error(), Data: errorData{Error: modbus.ErrNotPaired}}}
	}
	b, err := a.ID.Add(r.Name, r.Origin)
	if err != nil {
		return nil, err
	}
	a.Log.Info("browser paired", "origin", r.Origin, "name", r.Name, "id", b.ID)
	return map[string]string{"tokenId": b.ID, "secret": b.Secret, "publicKey": a.ID.PublicKey(), "fingerprint": a.ID.Fingerprint()}, nil
}

// --- connections ---

func (a *Agent) onFrame(c *Conn, f modbus.Frame) {
	c.mu.Lock()
	taps := make([]*Session, 0, len(c.taps))
	for s := range c.taps {
		taps = append(taps, s)
	}
	c.mu.Unlock()
	framing := "rtu"
	if c.Params.Kind == "tcp" {
		framing = "tcp"
	}
	ev := map[string]any{"connId": c.ID, "t": f.T.UnixMilli(), "dir": f.Dir, "bytes": hex.EncodeToString(f.Bytes), "framing": framing}
	if f.Error != "" {
		ev["error"] = f.Error
	}
	for _, s := range taps {
		s.notify("traffic.frame", ev)
	}
}

func (a *Agent) connOpen(s *Session, raw json.RawMessage) (any, error) {
	p, err := decode[OpenParams](raw)
	if err != nil {
		return nil, err
	}
	// The same port or host opened again (page reload, second tab) shares the connection.
	a.mu.Lock()
	for _, c := range a.conns {
		if c.Params == p {
			a.mu.Unlock()
			c.mu.Lock()
			c.leases[s] = true
			if c.closeAt != nil {
				c.closeAt.Stop()
				c.closeAt = nil
			}
			c.mu.Unlock()
			return map[string]string{"connId": c.ID, "label": c.Label}, nil
		}
	}
	a.mu.Unlock()
	c, err := openConn(newID(), p, a.onFrame)
	if err != nil {
		return nil, err
	}
	c.leases[s] = true
	a.mu.Lock()
	a.conns[c.ID] = c
	a.mu.Unlock()
	a.Log.Info("connection opened", "conn", c.ID, "label", c.Label)
	return map[string]string{"connId": c.ID, "label": c.Label}, nil
}

func (a *Agent) conn(id string) (*Conn, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	c := a.conns[id]
	if c == nil {
		return nil, &modbus.Error{Code: modbus.ErrPortDisconnected, Msg: "connection " + id + " is not open"}
	}
	return c, nil
}

func (a *Agent) connClose(s *Session, raw json.RawMessage) (any, error) {
	p, err := decode[struct{ ConnID string `json:"connId"` }](raw)
	if err != nil {
		return nil, err
	}
	c, err := a.conn(p.ConnID)
	if err != nil {
		return nil, nil
	}
	c.mu.Lock()
	delete(c.leases, s)
	delete(c.taps, s)
	c.mu.Unlock()
	a.maybeClose(c)
	return nil, nil
}

// maybeClose closes a connection nobody leases, after a grace period.
func (a *Agent) maybeClose(c *Conn) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.leases) > 0 || c.pinned > 0 || c.closeAt != nil {
		return
	}
	c.closeAt = time.AfterFunc(leaseGrace, func() { a.closeNow(c) })
}

func (a *Agent) closeNow(c *Conn) {
	c.mu.Lock()
	if len(c.leases) > 0 || c.pinned > 0 {
		c.closeAt = nil
		c.mu.Unlock()
		return
	}
	c.mu.Unlock()
	a.mu.Lock()
	delete(a.conns, c.ID)
	a.mu.Unlock()
	c.mu.Lock()
	client := c.client
	c.client = nil
	c.mu.Unlock()
	if client != nil {
		_ = client.Close()
	}
	a.Log.Info("connection closed", "conn", c.ID)
}

// ConnSummary is one entry of conn.list.
type ConnSummary struct {
	ConnID string     `json:"connId"`
	Label  string     `json:"label"`
	Params OpenParams `json:"params"`
	Stats  Stats      `json:"stats"`
}

func (a *Agent) connList() []ConnSummary {
	a.mu.Lock()
	defer a.mu.Unlock()
	out := []ConnSummary{}
	for _, c := range a.conns {
		out = append(out, ConnSummary{ConnID: c.ID, Label: c.Label, Params: c.Params, Stats: c.Stats()})
	}
	return out
}

func (a *Agent) connStats(raw json.RawMessage) (any, error) {
	p, err := decode[struct{ ConnID string `json:"connId"` }](raw)
	if err != nil {
		return nil, err
	}
	c, err := a.conn(p.ConnID)
	if err != nil {
		return nil, err
	}
	return c.Stats(), nil
}

type requestParams struct {
	ConnID       string         `json:"connId"`
	UnitID       byte           `json:"unitId"`
	Request      modbus.Request `json:"request"`
	TimeoutMs    int            `json:"timeoutMs"`
	ConfirmToken string         `json:"confirmToken,omitempty"`
}

func timeout(ms int) time.Duration {
	if ms <= 0 {
		ms = 1000
	}
	return time.Duration(min(ms, 30000)) * time.Millisecond
}

func (a *Agent) modbusRequest(s *Session, raw json.RawMessage, write bool) (any, error) {
	p, err := decode[requestParams](raw)
	if err != nil {
		return nil, err
	}
	if p.Request.IsWrite() != write {
		return nil, badParams(fmt.Sprintf("function %d does not belong to %s", p.Request.Fc, map[bool]string{true: "modbus.write", false: "modbus.read"}[write]))
	}
	if write {
		// One-use token minted by the confirmation dialog. It stops writes by
		// accident or by bugs; script injected into the page is the CSP's job.
		s.mu.Lock()
		used := p.ConfirmToken == "" || len(p.ConfirmToken) < 16 || s.usedTokens[p.ConfirmToken]
		if !used {
			s.usedTokens[p.ConfirmToken] = true
		}
		s.mu.Unlock()
		if used {
			return nil, &modbus.Error{Code: modbus.ErrConfirmRequired, Msg: "write without a fresh confirmToken"}
		}
	}
	c, err := a.conn(p.ConnID)
	if err != nil {
		return nil, err
	}
	return c.Do(p.UnitID, &p.Request, timeout(p.TimeoutMs))
}

func (a *Agent) trafficSubscribe(s *Session, raw json.RawMessage, on bool) (any, error) {
	p, err := decode[struct{ ConnID string `json:"connId"` }](raw)
	if err != nil {
		return nil, err
	}
	c, err := a.conn(p.ConnID)
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	if on {
		c.taps[s] = true
	} else {
		delete(c.taps, s)
	}
	c.mu.Unlock()
	return nil, nil
}

// Shutdown stops polls, scans and simulators and closes connections.
func (a *Agent) Shutdown() {
	a.mu.Lock()
	ids := make([]string, 0, len(a.polls))
	for id := range a.polls {
		ids = append(ids, id)
	}
	for _, cancel := range a.scans {
		cancel()
	}
	sims := make([]string, 0, len(a.sims))
	for id := range a.sims {
		sims = append(sims, id)
	}
	conns := make([]*Conn, 0, len(a.conns))
	for _, c := range a.conns {
		conns = append(conns, c)
	}
	loggers := make([]*logger, 0, len(a.loggers))
	for _, l := range a.loggers {
		loggers = append(loggers, l)
	}
	a.mu.Unlock()
	// Loggers stop without being marked stopped: they resume on the next start.
	for _, l := range loggers {
		l.halt()
	}
	for _, id := range ids {
		a.stopPoll(id)
	}
	for _, id := range sims {
		_, _ = a.simStop(json.RawMessage(fmt.Sprintf(`{"simId":%q}`, id)))
	}
	for _, c := range conns {
		c.mu.Lock()
		if c.client != nil {
			_ = c.client.Close()
		}
		c.mu.Unlock()
	}
}

// reportSign signs the SHA-256 of a report's session data. Only the hash
// travels; anyone with the CSV and the agent's public key can verify it.
func (a *Agent) reportSign(raw json.RawMessage) (any, error) {
	p, err := decode[struct{ Hash string `json:"hash"` }](raw)
	if err != nil {
		return nil, err
	}
	if b, err := hex.DecodeString(p.Hash); err != nil || len(b) != 32 || strings.ToLower(p.Hash) != p.Hash {
		return nil, badParams("hash must be 64 lowercase hex characters (SHA-256)")
	}
	sig := a.ID.Sign([]byte("modfield-report:v1:" + p.Hash))
	return map[string]string{"signature": base64.RawURLEncoding.EncodeToString(sig), "publicKey": a.ID.PublicKey(), "fingerprint": a.ID.Fingerprint()}, nil
}
