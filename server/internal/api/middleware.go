package api

import (
	"log/slog"
	"net/http"
	"runtime/debug"
	"time"
)

// Middleware is one link in the handler chain. Every request goes through the
// chain, so adding authentication later is an insertion rather than a rewrite.
type Middleware func(http.Handler) http.Handler

// Chain applies middleware to h so that the first element is outermost.
func Chain(h http.Handler, middleware ...Middleware) http.Handler {
	for i := len(middleware) - 1; i >= 0; i-- {
		h = middleware[i](h)
	}
	return h
}

// statusRecorder captures status and byte count for logging without buffering
// the body, and forwards Flush so streaming responses are not held back.
type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (r *statusRecorder) WriteHeader(status int) {
	if r.status == 0 {
		r.status = status
	}
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	n, err := r.ResponseWriter.Write(b)
	r.bytes += int64(n)
	return n, err
}

// Unwrap lets http.ResponseController reach the real writer, so a handler that
// needs Flush or Hijack is not blocked by this wrapper.
func (r *statusRecorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }

func (r *statusRecorder) Flush() {
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Logger logs one line per request.
func Logger(log *slog.Logger) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w}
			next.ServeHTTP(rec, req)
			if rec.status == 0 {
				rec.status = http.StatusOK
			}
			// Path only, never the query string: browse paths carry the user's
			// own directory names.
			log.Debug("request",
				"method", req.Method,
				"path", req.URL.Path,
				"status", rec.status,
				"bytes", rec.bytes,
				"duration", time.Since(start),
			)
		})
	}
}

// Recoverer turns a panicking handler into a 500 instead of a dropped
// connection.
func Recoverer(log *slog.Logger) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					if rec == http.ErrAbortHandler {
						panic(rec)
					}
					log.Error("panic serving request",
						"method", req.Method,
						"path", req.URL.Path,
						"panic", rec,
						"stack", string(debug.Stack()),
					)
					writeError(w, http.StatusInternalServerError, "internal error")
				}
			}()
			next.ServeHTTP(w, req)
		})
	}
}
