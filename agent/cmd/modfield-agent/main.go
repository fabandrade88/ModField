// Command modfield-agent is the ModField local agent: Modbus RTU and TCP for
// the browser over a WebSocket on 127.0.0.1, without administrator rights.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"modfield.dev/agent/internal/agent"
	"modfield.dev/agent/internal/identity"
	"modfield.dev/agent/internal/logstore"
	"modfield.dev/agent/internal/platform"
	"modfield.dev/agent/internal/server"
	"modfield.dev/agent/internal/update"
	"modfield.dev/agent/web"
)

// Set by the release build (-ldflags "-X main.version=...").
var (
	version        = "1.0.0"
	officialOrigin = "https://modfield.app"
)

type origins []string

func (o *origins) String() string     { return strings.Join(*o, ",") }
func (o *origins) Set(v string) error { *o = append(*o, v); return nil }

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "version":
			fmt.Println(version)
			return
		case "pair":
			os.Exit(pairCLI(os.Args[2:]))
		case "rollback":
			if err := update.Rollback(); err != nil {
				fmt.Fprintln(os.Stderr, err)
				os.Exit(1)
			}
			fmt.Println("previous version restored; start the agent again")
			return
		}
	}
	var (
		headless  = flag.Bool("headless", false, "run without the tray icon (Raspberry Pi, servers)")
		port      = flag.Int("port", 0, "listen on this port only (default: first free of 47807-47809)")
		dataDir   = flag.String("data-dir", platform.DataDir(), "where keys, tokens and logs live")
		dev       = flag.Bool("dev", false, "development: also accept http://localhost:3000")
		testCode  = flag.String("test-pairing-code", "", "fixed pairing code (only with --dev, for automated tests)")
		noBrowser = flag.Bool("no-browser", false, "do not open the pairing page in the browser")
		noUpdate  = flag.Bool("no-update", false, "disable the daily update check")
		simAddr   = flag.String("sim", "", "start the demo slave simulator on this TCP address (e.g. 127.0.0.1:5020)")
		extra     origins
	)
	flag.Var(&extra, "allow-origin", "additional allowed origin (with --dev, repeatable)")
	flag.Parse()

	log := slog.New(slog.NewTextHandler(logOutput(*dataDir, *headless), &slog.HandlerOptions{Level: slog.LevelInfo}))
	if err := update.ApplyPending(*dataDir, log); err != nil {
		log.Warn("pending update not applied", "err", err)
	}
	id, err := identity.Open(*dataDir)
	if err != nil {
		log.Error("cannot open data directory", "dir", *dataDir, "err", err)
		os.Exit(1)
	}
	a := agent.New(version, id, log)
	a.DataDir = *dataDir
	if a.Logs, err = logstore.Open(filepath.Join(*dataDir, "logs")); err != nil {
		log.Error("cannot open the log store", "err", err)
		os.Exit(1)
	}
	if !*noBrowser {
		a.OpenURL = platform.OpenURL
	}
	cfg := server.Config{OfficialOrigin: officialOrigin, Port: *port, UI: web.UI(), DataDir: *dataDir}
	if *dev {
		cfg.ExtraOrigins = append([]string{"http://localhost:3000"}, extra...)
		if *testCode != "" {
			a.Pairing.FixedCode = *testCode
		}
	} else if len(extra) > 0 || *testCode != "" {
		log.Error("--allow-origin and --test-pairing-code need --dev")
		os.Exit(2)
	}
	srv, err := server.New(cfg, a, log)
	if err != nil {
		log.Error("server", "err", err)
		os.Exit(1)
	}
	p, err := srv.Listen()
	if err != nil {
		log.Error("cannot listen", "err", err)
		os.Exit(1)
	}
	if *simAddr != "" {
		if s, err := a.StartDemoSim(*simAddr); err != nil {
			log.Error("simulator", "err", err)
		} else {
			log.Info("demo simulator running", "addr", s.Addr)
		}
	}
	a.ResumeLogs()
	log.Info("agent ready", "version", version, "url", a.BaseURL, "data", *dataDir, "fingerprint", id.Fingerprint())

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if !*noUpdate && !*dev {
		go update.Loop(ctx, update.Config{Current: version, DataDir: *dataDir, Log: log})
	}
	go func() {
		if err := srv.Serve(); err != nil {
			log.Error("server stopped", "err", err)
			stop()
		}
	}()

	quit := func() {
		sctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = srv.Shutdown(sctx)
		a.Shutdown()
	}
	if *headless {
		<-ctx.Done()
		quit()
		return
	}
	runTray(ctx, a, p, *dataDir, quit)
}

// logOutput is stderr, except for the Windows tray build: it has no console
// (-H windowsgui), so it logs to <data>/agent.log, rotated at 5 MB.
func logOutput(dataDir string, headless bool) io.Writer {
	if runtime.GOOS != "windows" || headless {
		return os.Stderr
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return os.Stderr
	}
	path := filepath.Join(dataDir, "agent.log")
	if st, err := os.Stat(path); err == nil && st.Size() > 5<<20 {
		_ = os.Rename(path, path+".old")
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return os.Stderr
	}
	return f
}

// pairCLI prints pending pairing codes, for agents without a screen.
func pairCLI(args []string) int {
	fs := flag.NewFlagSet("pair", flag.ExitOnError)
	dataDir := fs.String("data-dir", platform.DataDir(), "agent data directory")
	_ = fs.Parse(args)
	tok, err := os.ReadFile(filepath.Join(*dataDir, "admin.token"))
	if err != nil {
		fmt.Fprintln(os.Stderr, "the agent does not seem to be running:", err)
		return 1
	}
	for _, p := range server.Ports {
		req, _ := http.NewRequest("GET", fmt.Sprintf("http://127.0.0.1:%d/admin/pending", p), nil)
		req.Header.Set("X-ModField-Admin", string(tok))
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			continue
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != 200 {
			continue
		}
		var pending []identity.Request
		_ = json.Unmarshal(body, &pending)
		if len(pending) == 0 {
			fmt.Println("No pairing request. In the site, click \"Parear com o agente\", then run this again.")
			return 0
		}
		for _, r := range pending {
			fmt.Printf("%s  %s  (%s, until %s)\n", r.Code, r.Name, r.Origin, r.Expires.Local().Format("15:04:05"))
		}
		return 0
	}
	fmt.Fprintln(os.Stderr, "no agent answered on ports", server.Ports)
	return 1
}
