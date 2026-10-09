// Package server is the agent's HTTP side: the WebSocket API on /v1, the
// local pages (/pair, /browsers) and the embedded web UI. It listens on
// 127.0.0.1 only and checks the Origin of every API request.
package server

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"modfield.dev/agent/internal/agent"
)

// Ports tried in order; the site probes the same three.
var Ports = []int{47807, 47808, 47809}

// Config is what main passes in.
type Config struct {
	// OfficialOrigin is the public site, e.g. https://modfield.app.
	OfficialOrigin string
	// ExtraOrigins are accepted too (development: http://localhost:3000).
	ExtraOrigins []string
	// Port forces one port (0 = try Ports).
	Port int
	// AnyPort picks a free port (tests).
	AnyPort bool
	// UI is the embedded web build (may be empty).
	UI fs.FS
	// DataDir holds admin.token for the CLI.
	DataDir string
}

// Server is the running HTTP server.
type Server struct {
	cfg     Config
	agent   *agent.Agent
	log     *slog.Logger
	srv     *http.Server
	ln      net.Listener
	admin   string
	allowed []string
	mu      sync.Mutex
}

// New prepares a server; call Listen then Serve.
func New(cfg Config, a *agent.Agent, log *slog.Logger) (*Server, error) {
	s := &Server{cfg: cfg, agent: a, log: log}
	tok := make([]byte, 24)
	_, _ = rand.Read(tok)
	s.admin = hex.EncodeToString(tok)
	if cfg.DataDir != "" {
		// The CLI (`modfield-agent pair`) reads this to fetch pending codes; mode 0600.
		if err := os.WriteFile(filepath.Join(cfg.DataDir, "admin.token"), []byte(s.admin), 0o600); err != nil {
			return nil, err
		}
	}
	return s, nil
}

// Listen binds 127.0.0.1 on the first free port.
func (s *Server) Listen() (int, error) {
	ports := Ports
	if s.cfg.Port != 0 {
		ports = []int{s.cfg.Port}
	}
	if s.cfg.AnyPort {
		ports = []int{0}
	}
	var last error
	for _, p := range ports {
		ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p))
		if err != nil {
			last = err
			continue
		}
		s.ln = ln
		port := ln.Addr().(*net.TCPAddr).Port
		self := fmt.Sprintf("http://127.0.0.1:%d", port)
		s.allowed = append([]string{s.cfg.OfficialOrigin, self, fmt.Sprintf("http://localhost:%d", port)}, s.cfg.ExtraOrigins...)
		s.agent.BaseURL = self
		return port, nil
	}
	return 0, fmt.Errorf("ports %v are busy: %w", ports, last)
}

// Allowed reports whether an Origin may use the API.
func (s *Server) Allowed(origin string) bool {
	return origin != "" && slices.Contains(s.allowed, origin)
}

// Serve blocks until Shutdown.
func (s *Server) Serve() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1", s.ws)
	mux.HandleFunc("/v1/hello", s.hello)
	mux.HandleFunc("/pair", s.pairPage)
	mux.HandleFunc("/browsers", s.browsersPage)
	mux.HandleFunc("/admin/pending", s.adminPending)
	mux.Handle("/", s.ui())
	s.srv = &http.Server{Handler: s.headers(mux), ReadHeaderTimeout: 10 * time.Second}
	err := s.srv.Serve(s.ln)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

// Shutdown stops the server.
func (s *Server) Shutdown(ctx context.Context) error {
	if s.srv == nil {
		return nil
	}
	return s.srv.Shutdown(ctx)
}

// headers adds CORS and Private/Local Network Access answers for allowed origins only.
func (s *Server) headers(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		origin := r.Header.Get("Origin")
		if strings.HasPrefix(r.URL.Path, "/v1") && s.Allowed(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			if r.Header.Get("Access-Control-Request-Private-Network") == "true" || r.Header.Get("Access-Control-Request-Local-Network") == "true" {
				w.Header().Set("Access-Control-Allow-Private-Network", "true")
				w.Header().Set("Access-Control-Allow-Local-Network", "true")
			}
			if r.Method == http.MethodOptions {
				w.Header().Set("Access-Control-Allow-Methods", "GET")
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) hello(w http.ResponseWriter, r *http.Request) {
	if !s.Allowed(r.Header.Get("Origin")) {
		http.Error(w, "ORIGIN_REJECTED", http.StatusForbidden)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(s.agent.Handle(&agent.Session{}, []byte(`{"jsonrpc":"2.0","id":0,"method":"agent.hello"}`)))
}

func (s *Server) ws(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if !s.Allowed(origin) {
		s.log.Warn("origin rejected", "origin", origin)
		http.Error(w, "ORIGIN_REJECTED", http.StatusForbidden)
		return
	}
	if s.agent.Paused() {
		http.Error(w, "paused", http.StatusServiceUnavailable)
		return
	}
	// The origin was checked above against full scheme://host:port; the library's
	// host-only patterns would be looser.
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	c.SetReadLimit(1 << 20)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	out := make(chan []byte, 1024)
	send := func(v any) {
		b, err := json.Marshal(v)
		if err != nil {
			return
		}
		select {
		case out <- b:
		default: // a slow browser loses notifications, never blocks the bus
		}
	}
	sess := s.agent.NewSession(origin, send)
	defer s.agent.EndSession(sess)
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case b := <-out:
				wctx, wcancel := context.WithTimeout(ctx, 5*time.Second)
				err := c.Write(wctx, websocket.MessageText, b)
				wcancel()
				if err != nil {
					cancel()
					return
				}
			}
		}
	}()
	for {
		_, msg, err := c.Read(ctx)
		if err != nil {
			c.Close(websocket.StatusNormalClosure, "")
			return
		}
		// Requests run concurrently: a slow read on one connection must not block the others.
		go func(msg []byte) {
			if resp := s.agent.Handle(sess, msg); resp != nil {
				send(resp)
			}
		}(msg)
	}
}

func (s *Server) adminPending(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-ModField-Admin") != s.admin {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(s.agent.Pairing.Pending())
}

var pageTmpl = template.Must(template.New("page").Parse(`<!doctype html>
<html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
{{if .Refresh}}<meta http-equiv="refresh" content="2">{{end}}
<title>{{.Title}} · ModField</title>
<style>
body{font:14px ui-monospace,Menlo,monospace;background:#1a1b26;color:#c0caf5;margin:0;padding:24px}
h1{font-size:16px;font-weight:normal;border-bottom:1px solid #2f3449;padding-bottom:8px}
.code{font-size:40px;letter-spacing:8px;margin:8px 0}
.muted{color:#a9b1d6} table{border-collapse:collapse} td{padding:4px 12px 4px 0;border-bottom:1px solid #2f3449}
button{font:inherit;min-height:32px;background:#24283b;color:#c0caf5;border:1px solid #f7768e;padding:0 12px}
@media (prefers-color-scheme: light){body{background:#fff;color:#000}.muted{color:#3d3d3d}td,h1{border-color:#8a8a8a}button{background:#f4f4f4;color:#b00020}}
</style></head><body>
<h1>ModField · {{.Title}}</h1>
{{.Body}}
<p class="muted">Agente {{.Version}} · chave {{.Fingerprint}}</p>
</body></html>`))

func (s *Server) page(w http.ResponseWriter, title string, refresh bool, body template.HTML) {
	// Local pages: no scripts at all, and nobody may frame them.
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = pageTmpl.Execute(w, map[string]any{"Title": title, "Refresh": refresh, "Body": body, "Version": s.agent.Version, "Fingerprint": s.agent.ID.Fingerprint()})
}

func (s *Server) pairPage(w http.ResponseWriter, r *http.Request) {
	pending := s.agent.Pairing.Pending()
	var b strings.Builder
	if len(pending) == 0 {
		b.WriteString(`<p>Nenhum pedido de pareamento. No site, clique em "Parear com o agente".</p>`)
	}
	for _, p := range pending {
		fmt.Fprintf(&b, `<p class="muted">%s pediu acesso a partir de %s. Digite este código no site:</p><p class="code">%s</p><p class="muted">Válido até %s.</p>`,
			template.HTMLEscapeString(p.Name), template.HTMLEscapeString(p.Origin), template.HTMLEscapeString(p.Code), p.Expires.Local().Format("15:04:05"))
	}
	b.WriteString(`<p class="muted">Se você não pediu isso, feche esta página. Nada é autorizado sem o código.</p>`)
	s.page(w, "Parear navegador", true, template.HTML(b.String()))
}

// browsersPage lists paired browsers; revoking is a form POST that must come from this page.
func (s *Server) browsersPage(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		// Cross-site forms carry their own Origin; only the agent's own page may revoke.
		if r.Header.Get("Origin") != s.agent.BaseURL {
			http.Error(w, "ORIGIN_REJECTED", http.StatusForbidden)
			return
		}
		if id := r.FormValue("id"); id != "" {
			_ = s.agent.RevokeBrowser(id)
		}
		http.Redirect(w, r, "/browsers", http.StatusSeeOther)
		return
	}
	list := s.agent.ID.List()
	var b strings.Builder
	if len(list) == 0 {
		b.WriteString(`<p>Nenhum navegador pareado.</p>`)
	} else {
		b.WriteString(`<table><tr class="muted"><td>Nome</td><td>Origem</td><td>Pareado</td><td>Último uso</td><td></td></tr>`)
		for _, br := range list {
			last := "—"
			if !br.LastSeen.IsZero() {
				last = br.LastSeen.Local().Format("2006-01-02 15:04")
			}
			fmt.Fprintf(&b, `<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td><form method="post"><input type="hidden" name="id" value="%s"><button>Revogar</button></form></td></tr>`,
				template.HTMLEscapeString(br.Name), template.HTMLEscapeString(br.Origin), br.Created.Local().Format("2006-01-02 15:04"), last, template.HTMLEscapeString(br.ID))
		}
		b.WriteString(`</table>`)
	}
	s.page(w, "Navegadores pareados", false, template.HTML(b.String()))
}

// ui serves the embedded web build, so browsers that block the public site's
// access to localhost (Safari, policy, denied permission) still work.
func (s *Server) ui() http.Handler {
	if s.cfg.UI == nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			s.page(w, "Agente local", false, template.HTML(`<p>Este agente foi compilado sem a interface embutida. Use o site.</p>`))
		})
	}
	files := http.FileServer(http.FS(s.cfg.UI))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := fs.Stat(s.cfg.UI, strings.TrimPrefix(filepath.Clean(r.URL.Path), "/")); err != nil && r.URL.Path != "/" {
			if f, err := fs.ReadFile(s.cfg.UI, "404.html"); err == nil {
				w.Header().Set("Content-Type", "text/html; charset=utf-8")
				w.WriteHeader(http.StatusNotFound)
				_, _ = w.Write(f)
				return
			}
		}
		files.ServeHTTP(w, r)
	})
}
