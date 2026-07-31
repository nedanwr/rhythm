// Command rhythm serves a music library over HTTP together with the embedded web client.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/nedanwr/rhythm/server/internal/api"
	"github.com/nedanwr/rhythm/server/internal/art"
	"github.com/nedanwr/rhythm/server/internal/library"
	"github.com/nedanwr/rhythm/server/internal/webui"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "rhythm:", err)
		os.Exit(1)
	}
}

type config struct {
	music    string
	dataDir  string
	host     string
	port     int
	logLevel string
}

func run(args []string) error {
	fs := flag.NewFlagSet("rhythm", flag.ContinueOnError)
	var cfg config
	fs.StringVar(&cfg.music, "music", "", "path to a music library root (required)")
	fs.StringVar(&cfg.dataDir, "data-dir", "", "directory for Rhythm's own data (default: OS user config dir)")
	// Loopback by default: there is no authentication yet.
	fs.StringVar(&cfg.host, "host", "127.0.0.1", "address to bind")
	fs.IntVar(&cfg.port, "port", 4533, "port to bind (0 picks a free port)")
	fs.StringVar(&cfg.logLevel, "log-level", "info", "log level: debug, info, warn, error")
	if err := fs.Parse(args); err != nil {
		return err
	}

	level, err := parseLevel(cfg.logLevel)
	if err != nil {
		return err
	}
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level}))

	if cfg.music == "" {
		return errors.New("--music is required")
	}
	registry, err := buildRegistry(cfg.music)
	if err != nil {
		return err
	}
	dataDir, err := resolveDataDir(cfg.dataDir)
	if err != nil {
		return err
	}

	ui, uiBuilt := webui.FS()
	handler, err := api.New(api.Options{
		Registry: registry,
		Logger:   log,
		UI:       ui,
		UIBuilt:  uiBuilt,
		// Derived data — deleting it costs one re-extraction per image.
		ArtCache: &art.Cache{Dir: filepath.Join(dataDir, "art")},
	})
	if err != nil {
		return err
	}

	ln, err := net.Listen("tcp", net.JoinHostPort(cfg.host, fmt.Sprint(cfg.port)))
	if err != nil {
		return err
	}

	root, err := registry.DefaultRoot()
	if err != nil {
		return err
	}
	log.Info("rhythm listening",
		"address", "http://"+ln.Addr().String(),
		"music", root.Path,
		"data-dir", dataDir,
		"ui", map[bool]string{true: "embedded", false: "not built"}[uiBuilt],
	)

	return serve(log, ln, handler)
}

// serve runs the HTTP server until an interrupt, then drains in-flight requests.
func serve(log *slog.Logger, ln net.Listener, handler http.Handler) error {
	srv := &http.Server{
		Handler: handler,
		// No write timeout: streaming a large file over a slow link is normal here.
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() { errCh <- srv.Serve(ln) }()

	select {
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		log.Info("shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			return err
		}
		if err := <-errCh; err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	}
}

// buildRegistry creates the implicit default library: one library, one root.
func buildRegistry(musicPath string) (*library.Registry, error) {
	abs, err := filepath.Abs(musicPath)
	if err != nil {
		return nil, err
	}
	// Resolve symlinks once here so later containment checks mean something.
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return nil, fmt.Errorf("music root %q: %w", musicPath, err)
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("music root %q is not a directory", musicPath)
	}
	return library.NewRegistry(&library.Library{
		ID:   "default",
		Name: "Music",
		Roots: []*library.Root{{
			ID:   "default",
			Name: filepath.Base(resolved),
			Path: resolved,
		}},
	})
}

// resolveDataDir returns Rhythm's state directory, creating it if needed.
func resolveDataDir(dataDir string) (string, error) {
	if dataDir == "" {
		base, err := os.UserConfigDir()
		if err != nil {
			return "", err
		}
		dataDir = filepath.Join(base, "rhythm")
	}
	abs, err := filepath.Abs(dataDir)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(abs, 0o700); err != nil {
		return "", err
	}
	return abs, nil
}

func parseLevel(name string) (slog.Level, error) {
	var level slog.Level
	if err := level.UnmarshalText([]byte(name)); err != nil {
		return 0, fmt.Errorf("invalid --log-level %q", name)
	}
	return level, nil
}
