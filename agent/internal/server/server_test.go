package server

import (
	"context"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"modfield.dev/agent/internal/agent"
	"modfield.dev/agent/internal/identity"
	"modfield.dev/agent/internal/logstore"
)

const site = "https://modfield.app"

var b64 = base64.RawURLEncoding

type harness struct {
	t     *testing.T
	agent *agent.Agent
	base  string
	dir   string
	stop  func()
}

func start(t *testing.T) *harness { return startIn(t, t.TempDir()) }

// startIn runs an agent on dir; the same dir again is an agent restart.
func startIn(t *testing.T, dir string) *harness {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	id, err := identity.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	a := agent.New("test", id, log)
	a.DataDir = dir
	if a.Logs, err = logstore.Open(filepath.Join(dir, "logs")); err != nil {
		t.Fatal(err)
	}
	a.ResumeLogs()
	srv, err := New(Config{OfficialOrigin: site, AnyPort: true, DataDir: t.TempDir()}, a, log)
	if err != nil {
		t.Fatal(err)
	}
	port, err := srv.Listen()
	if err != nil {
		t.Fatal(err)
	}
	go func() { _ = srv.Serve() }()
	var once sync.Once
	stop := func() {
		once.Do(func() {
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			_ = srv.Shutdown(ctx)
			a.Shutdown()
		})
	}
	t.Cleanup(stop)
	return &harness{t: t, agent: a, base: fmt.Sprintf("http://127.0.0.1:%d", port), dir: dir, stop: stop}
}

type client struct {
	t     *testing.T
	c     *websocket.Conn
	mu    sync.Mutex
	next  int64
	resp  map[int64]chan map[string]any
	notes chan map[string]any
}

func (h *harness) dial(origin string) (*client, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	ws := strings.Replace(h.base, "http", "ws", 1) + "/v1"
	c, _, err := websocket.Dial(ctx, ws, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {origin}}})
	if err != nil {
		return nil, err
	}
	cl := &client{t: h.t, c: c, resp: map[int64]chan map[string]any{}, notes: make(chan map[string]any, 1000)}
	go func() {
		for {
			_, b, err := c.Read(context.Background())
			if err != nil {
				return
			}
			var m map[string]any
			_ = json.Unmarshal(b, &m)
			if id, ok := m["id"].(float64); ok {
				cl.mu.Lock()
				ch := cl.resp[int64(id)]
				cl.mu.Unlock()
				if ch != nil {
					ch <- m
				}
			} else {
				cl.notes <- m
			}
		}
	}()
	h.t.Cleanup(func() { c.Close(websocket.StatusNormalClosure, "") })
	return cl, nil
}

// call returns (result, errorData) of one request.
func (c *client) call(method string, params any) (map[string]any, map[string]any) {
	c.t.Helper()
	c.mu.Lock()
	c.next++
	id := c.next
	ch := make(chan map[string]any, 1)
	c.resp[id] = ch
	c.mu.Unlock()
	b, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
	if err := c.c.Write(context.Background(), websocket.MessageText, b); err != nil {
		c.t.Fatal(err)
	}
	select {
	case m := <-ch:
		if e, ok := m["error"].(map[string]any); ok {
			d, _ := e["data"].(map[string]any)
			if d == nil {
				d = map[string]any{"message": e["message"]}
			}
			return nil, d
		}
		r, _ := m["result"].(map[string]any)
		return r, nil
	case <-time.After(5 * time.Second):
		c.t.Fatalf("%s: no response", method)
	}
	return nil, nil
}

func (c *client) wait(method string) map[string]any {
	c.t.Helper()
	deadline := time.After(5 * time.Second)
	for {
		select {
		case n := <-c.notes:
			if n["method"] == method {
				return n["params"].(map[string]any)
			}
		case <-deadline:
			c.t.Fatalf("no %s notification", method)
		}
	}
}

// pair runs pair.begin/complete the way the site does and returns the token.
func (h *harness) pair(c *client) (tokenID, secret, pub string) {
	h.t.Helper()
	r, e := c.call("pair.begin", map[string]string{"name": "Chrome teste"})
	if e != nil {
		h.t.Fatal(e)
	}
	code := h.agent.Pairing.Pending()[0].Code
	r, e = c.call("pair.complete", map[string]string{"requestId": r["requestId"].(string), "code": code})
	if e != nil {
		h.t.Fatal(e)
	}
	return r["tokenId"].(string), r["secret"].(string), r["publicKey"].(string)
}

// auth does the mutual challenge: verify the agent's signature, then MAC the token.
func authenticate(t *testing.T, c *client, origin, tokenID, secret, pub string) map[string]any {
	t.Helper()
	nonce := b64.EncodeToString([]byte("browser-nonce-0123456789abcdef"))
	r, e := c.call("agent.challenge", map[string]string{"nonce": nonce})
	if e != nil {
		t.Fatal(e)
	}
	pk, _ := b64.DecodeString(pub)
	sig, _ := b64.DecodeString(r["signature"].(string))
	agentNonce := r["agentNonce"].(string)
	if !ed25519.Verify(pk, identity.AgentAuthMessage(origin, nonce, agentNonce), sig) {
		t.Fatal("agent signature does not verify against the pinned key")
	}
	key, _ := b64.DecodeString(secret)
	mac := hmac.New(sha256.New, key)
	mac.Write(identity.BrowserAuthMessage(agentNonce, nonce))
	_, e = c.call("agent.auth", map[string]string{"tokenId": tokenID, "mac": b64.EncodeToString(mac.Sum(nil))})
	return e
}

func TestOriginIsChecked(t *testing.T) {
	h := start(t)
	if _, err := h.dial("https://evil.example"); err == nil {
		t.Fatal("foreign origin accepted")
	}
	res, err := http.Get(h.base + "/v1/hello")
	if err != nil || res.StatusCode != 403 {
		t.Fatalf("hello without origin: %v %v", res.StatusCode, err)
	}
	req, _ := http.NewRequest("OPTIONS", h.base+"/v1/hello", nil)
	req.Header.Set("Origin", site)
	req.Header.Set("Access-Control-Request-Private-Network", "true")
	res, err = http.DefaultClient.Do(req)
	if err != nil || res.Header.Get("Access-Control-Allow-Private-Network") != "true" || res.Header.Get("Access-Control-Allow-Origin") != site {
		t.Fatalf("preflight: %v %v", res.Header, err)
	}
}

func TestUnpairedIsRefused(t *testing.T) {
	h := start(t)
	c, err := h.dial(site)
	if err != nil {
		t.Fatal(err)
	}
	r, e := c.call("agent.hello", nil)
	if e != nil || r["publicKey"] == "" || r["protocol"].(map[string]any)["major"].(float64) != 1 {
		t.Fatalf("hello: %v %v", r, e)
	}
	if _, e := c.call("serial.list", nil); e["error"] != "NOT_PAIRED" {
		t.Fatalf("serial.list before auth: %v", e)
	}
}

func TestPairAuthReadWrite(t *testing.T) {
	h := start(t)
	c, _ := h.dial(site)
	tokenID, secret, pub := h.pair(c)

	// A fresh tab authenticates with the token.
	c2, _ := h.dial(site)
	if e := authenticate(t, c2, site, tokenID, secret, pub); e != nil {
		t.Fatalf("auth: %v", e)
	}
	// The same token from another origin is refused.
	other := "http://localhost:" + strings.TrimPrefix(h.base, "http://127.0.0.1:")
	c3, _ := h.dial(other)
	if e := authenticate(t, c3, other, tokenID, secret, pub); e == nil {
		t.Fatal("token accepted from another origin")
	}

	sim, e := c2.call("sim.start", map[string]any{"transport": "tcp", "listen": "127.0.0.1:0"})
	if e != nil {
		t.Fatal(e)
	}
	if _, e := c2.call("sim.start", map[string]any{"transport": "tcp", "listen": "0.0.0.0:0"}); e == nil {
		t.Fatal("simulator on the LAN without allowLan")
	}
	host, port, _ := strings.Cut(sim["addr"].(string), ":")
	var p int
	fmt.Sscan(port, &p)
	conn, e := c2.call("conn.open", map[string]any{"kind": "tcp", "host": host, "tcpPort": p})
	if e != nil {
		t.Fatal(e)
	}
	id := conn["connId"].(string)
	if _, e := c2.call("traffic.subscribe", map[string]string{"connId": id}); e != nil {
		t.Fatal(e)
	}

	r, e := c2.call("modbus.read", map[string]any{"connId": id, "unitId": 1, "request": map[string]any{"fc": 3, "address": 0, "quantity": 2}, "timeoutMs": 500})
	if e != nil || r["registers"].([]any)[1].(float64) != 4500 {
		t.Fatalf("read: %v %v", r, e)
	}
	frame := c2.wait("traffic.frame")
	if frame["framing"] != "tcp" || frame["dir"] != "tx" {
		t.Fatalf("traffic: %v", frame)
	}

	write := func(token string) map[string]any {
		_, e := c2.call("modbus.write", map[string]any{"connId": id, "unitId": 1, "request": map[string]any{"fc": 6, "address": 1, "value": 5000}, "timeoutMs": 500, "confirmToken": token})
		return e
	}
	if e := write(""); e["error"] != "CONFIRM_REQUIRED" {
		t.Fatalf("write without token: %v", e)
	}
	tok := "4f1c2d6e-1111-4222-8333-944455556666"
	if e := write(tok); e != nil {
		t.Fatalf("write: %v", e)
	}
	if e := write(tok); e["error"] != "CONFIRM_REQUIRED" {
		t.Fatalf("reused token: %v", e)
	}
	if _, e := c2.call("modbus.read", map[string]any{"connId": id, "unitId": 1, "request": map[string]any{"fc": 6, "address": 1, "value": 1}}); e == nil {
		t.Fatal("a write sent through modbus.read")
	}
	r, _ = c2.call("modbus.read", map[string]any{"connId": id, "unitId": 1, "request": map[string]any{"fc": 3, "address": 1, "quantity": 1}, "timeoutMs": 500})
	if r["registers"].([]any)[0].(float64) != 5000 {
		t.Fatalf("written value: %v", r)
	}
	_, e = c2.call("modbus.read", map[string]any{"connId": id, "unitId": 1, "request": map[string]any{"fc": 3, "address": 50, "quantity": 1}, "timeoutMs": 500})
	if e["error"] != "MODBUS_EXCEPTION" || e["exception"].(float64) != 2 {
		t.Fatalf("exception: %v", e)
	}

	pl, e := c2.call("poll.start", map[string]any{"connId": id, "intervalMs": 100, "blocks": []map[string]any{
		{"unitId": 1, "table": "input", "offset": 0, "quantity": 5},
		{"unitId": 9, "table": "holding", "offset": 0, "quantity": 1},
	}, "timeoutMs": 100})
	if e != nil {
		t.Fatal(e)
	}
	cyc := c2.wait("poll.cycle")
	res := cyc["results"].([]any)
	if len(res[0].(map[string]any)["words"].([]any)) != 5 || res[1].(map[string]any)["error"].(map[string]any)["code"] != "TIMEOUT" {
		t.Fatalf("cycle: %v", cyc)
	}
	c2.call("poll.stop", map[string]string{"pollId": pl["pollId"].(string)})

	sc, e := c2.call("scan.start", map[string]any{"kind": "ids", "connId": id, "ids": []int{1, 2, 3, 4}, "timeoutMs": 100})
	if e != nil {
		t.Fatal(e)
	}
	var done map[string]any
	for done == nil || done["scanId"] != sc["scanId"] {
		done = c2.wait("scan.done")
	}
	if hits := done["hits"].([]any); len(hits) != 3 {
		t.Fatalf("scan: %v", done)
	}

	ipscan, _ := c2.call("scan.start", map[string]any{"kind": "ip", "from": "127.0.0.1", "to": "127.0.0.1", "port": p, "unitIds": []int{1, 9}, "timeoutMs": 200})
	done = nil
	for done == nil || done["scanId"] != ipscan["scanId"] {
		done = c2.wait("scan.done")
	}
	if hits := done["hits"].([]any); len(hits) != 1 || hits[0].(map[string]any)["ip"] != "127.0.0.1" {
		t.Fatalf("ip scan: %v", done)
	}
	if _, e := c2.call("scan.start", map[string]any{"kind": "ip", "from": "10.0.0.0", "to": "10.0.255.255"}); e == nil {
		t.Fatal("65k-host scan accepted")
	}
}

func TestRevokeOnlyFromAgentPage(t *testing.T) {
	h := start(t)
	c, _ := h.dial(site)
	tokenID, secret, pub := h.pair(c)

	post := func(origin string) int {
		req, _ := http.NewRequest("POST", h.base+"/browsers", strings.NewReader(url.Values{"id": {tokenID}}.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		req.Header.Set("Origin", origin)
		res, err := (&http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}).Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return res.StatusCode
	}
	if code := post(site); code != 403 {
		t.Fatalf("revoke from the public site: %d", code)
	}
	if code := post(h.base); code != 303 {
		t.Fatalf("revoke from the agent page: %d", code)
	}
	c2, _ := h.dial(site)
	if e := authenticate(t, c2, site, tokenID, secret, pub); e == nil {
		t.Fatal("revoked token still works")
	}
}

func TestPairPageShowsCode(t *testing.T) {
	h := start(t)
	c, _ := h.dial(site)
	c.call("pair.begin", map[string]string{"name": "<script>x</script>"})
	res, err := http.Get(h.base + "/pair")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	code := h.agent.Pairing.Pending()[0].Code
	if !strings.Contains(string(body), code) || strings.Contains(string(body), "<script>x") {
		t.Fatalf("pair page: %s", body)
	}
	if !strings.Contains(res.Header.Get("Content-Security-Policy"), "default-src 'none'") {
		t.Fatal("pair page without CSP")
	}
}

func TestLogSurvivesSessionsAndRestarts(t *testing.T) {
	dir := t.TempDir()
	h := startIn(t, dir)
	sim, err := h.agent.StartDemoSim("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	host, port, _ := strings.Cut(sim.Addr, ":")
	var p int
	fmt.Sscan(port, &p)
	c, _ := h.dial(site)
	tokenID, secret, pub := h.pair(c)
	if e := authenticate(t, c, site, tokenID, secret, pub); e != nil {
		t.Fatal(e)
	}
	start, e := c.call("log.start", map[string]any{
		"name": "comissionamento", "intervalMs": 100, "timeoutMs": 200,
		"conn":   map[string]any{"kind": "tcp", "host": host, "tcpPort": p},
		"blocks": []map[string]any{{"unitId": 1, "table": "input", "offset": 0, "quantity": 5}, {"unitId": 9, "table": "holding", "offset": 0, "quantity": 1}},
	})
	if e != nil {
		t.Fatal(e)
	}
	id := start["logId"].(string)
	cyc := c.wait("log.cycle")
	if cyc["seq"].(float64) < 1 || cyc["results"].([]any)[1].(map[string]any)["error"] != "TIMEOUT" {
		t.Fatalf("cycle: %v", cyc)
	}

	// The tab closes: the log goes on.
	c.c.Close(websocket.StatusNormalClosure, "")
	time.Sleep(700 * time.Millisecond)
	c2, _ := h.dial(site)
	authenticate(t, c2, site, tokenID, secret, pub)
	r, _ := c2.call("log.fetch", map[string]any{"logId": id, "fromSeq": 1, "max": 1000})
	recs := r["records"].([]any)
	if len(recs) < 4 {
		t.Fatalf("only %d records while no tab was open", len(recs))
	}
	first := recs[0].(map[string]any)
	if first["seq"].(float64) != 1 || len(first["results"].([]any)[0].(map[string]any)["words"].([]any)) != 5 {
		t.Fatalf("first record: %v", first)
	}
	last := recs[len(recs)-1].(map[string]any)["seq"].(float64)
	c2.call("log.ack", map[string]any{"logId": id, "seq": last})

	// The agent restarts (update, reboot): the log resumes on its own.
	h.stop()
	h2 := startIn(t, dir)
	sim2, err := h2.agent.StartDemoSim(sim.Addr)
	if err != nil {
		t.Skipf("simulator port reuse: %v", err)
	}
	_ = sim2
	time.Sleep(600 * time.Millisecond)
	c3, _ := h2.dial(site)
	if e := authenticate(t, c3, site, tokenID, secret, pub); e != nil {
		t.Fatalf("auth after restart: %v", e)
	}
	list, _ := c3.call("log.list", nil)
	logs := list["logs"].([]any)
	meta := logs[0].(map[string]any)
	if !meta["running"].(bool) || meta["lastSeq"].(float64) <= last || meta["ackedSeq"].(float64) != last {
		t.Fatalf("after restart: %v", meta)
	}
	if _, e := c3.call("log.delete", map[string]string{"logId": id}); e == nil {
		t.Fatal("deleted a running log")
	}
	c3.call("log.stop", map[string]string{"logId": id})
	list, _ = c3.call("log.list", nil)
	if list["logs"].([]any)[0].(map[string]any)["running"].(bool) {
		t.Fatal("log still running after stop")
	}
	if _, e := c3.call("log.delete", map[string]string{"logId": id}); e != nil {
		t.Fatal(e)
	}
}

func TestReportSign(t *testing.T) {
	h := start(t)
	c, _ := h.dial(site)
	tokenID, secret, pub := h.pair(c)
	if _, e := c.call("report.sign", map[string]string{"hash": strings.Repeat("ab", 32)}); e["error"] != "NOT_PAIRED" {
		t.Fatalf("unauthenticated sign: %v", e)
	}
	authenticate(t, c, site, tokenID, secret, pub)
	hash := strings.Repeat("0f", 32)
	r, e := c.call("report.sign", map[string]string{"hash": hash})
	if e != nil {
		t.Fatal(e)
	}
	pk, _ := b64.DecodeString(r["publicKey"].(string))
	sig, _ := b64.DecodeString(r["signature"].(string))
	if !ed25519.Verify(pk, []byte("modfield-report:v1:"+hash), sig) {
		t.Fatal("report signature does not verify")
	}
	if _, e := c.call("report.sign", map[string]string{"hash": "not-a-hash"}); e == nil {
		t.Fatal("bad hash accepted")
	}
}

func TestConnectionReopensAfterTheSlaveGoesAway(t *testing.T) {
	h := start(t)
	c, _ := h.dial(site)
	tokenID, secret, pub := h.pair(c)
	authenticate(t, c, site, tokenID, secret, pub)
	sim, _ := c.call("sim.start", map[string]any{"transport": "tcp", "listen": "127.0.0.1:0"})
	addr := sim["addr"].(string)
	host, port, _ := strings.Cut(addr, ":")
	var p int
	fmt.Sscan(port, &p)
	conn, _ := c.call("conn.open", map[string]any{"kind": "tcp", "host": host, "tcpPort": p})
	id := conn["connId"].(string)
	read := func() map[string]any {
		_, e := c.call("modbus.read", map[string]any{"connId": id, "unitId": 1, "request": map[string]any{"fc": 3, "address": 0, "quantity": 1}, "timeoutMs": 300})
		return e
	}
	if e := read(); e != nil {
		t.Fatal(e)
	}
	// The slave restarts on the same address.
	c.call("sim.stop", map[string]string{"simId": sim["simId"].(string)})
	if e := read(); e["error"] != "PORT_DISCONNECTED" && e["error"] != "CONN_REFUSED" {
		t.Fatalf("read while the slave is down: %v", e)
	}
	s2, e := c.call("sim.start", map[string]any{"transport": "tcp", "listen": addr})
	if e != nil {
		t.Fatal(e)
	}
	// The first read after the restart already works (reads reconnect once).
	if e := read(); e != nil {
		t.Fatalf("read after the slave came back: %v", e)
	}
	// A write on a dead link is never repeated.
	c.call("sim.stop", map[string]string{"simId": s2["simId"].(string)})
	c.call("sim.start", map[string]any{"transport": "tcp", "listen": addr})
	_, e = c.call("modbus.write", map[string]any{"connId": id, "unitId": 1, "request": map[string]any{"fc": 6, "address": 1, "value": 7}, "timeoutMs": 300, "confirmToken": "token-after-restart-0001"})
	if e == nil || e["error"] != "PORT_DISCONNECTED" {
		t.Fatalf("write on a dead link must fail, not be retried: %v", e)
	}
	// A new conn.open for the same address shares the (now healthy) connection.
	again, _ := c.call("conn.open", map[string]any{"kind": "tcp", "host": host, "tcpPort": p})
	if again["connId"] != id {
		t.Fatalf("expected the shared connection, got %v", again)
	}
}
