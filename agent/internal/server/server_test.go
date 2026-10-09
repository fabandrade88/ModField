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
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"modfield.dev/agent/internal/agent"
	"modfield.dev/agent/internal/identity"
)

const site = "https://modfield.app"

var b64 = base64.RawURLEncoding

type harness struct {
	t     *testing.T
	agent *agent.Agent
	base  string
}

func start(t *testing.T) *harness {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	id, err := identity.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	a := agent.New("test", id, log)
	srv, err := New(Config{OfficialOrigin: site, AnyPort: true, DataDir: t.TempDir()}, a, log)
	if err != nil {
		t.Fatal(err)
	}
	port, err := srv.Listen()
	if err != nil {
		t.Fatal(err)
	}
	go func() { _ = srv.Serve() }()
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
		a.Shutdown()
	})
	return &harness{t: t, agent: a, base: fmt.Sprintf("http://127.0.0.1:%d", port)}
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
