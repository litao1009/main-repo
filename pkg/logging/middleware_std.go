package logging

import (
	"bytes"
	"io"
	"net/http"
	"strings"
	"time"
)

type responseWriter struct {
	http.ResponseWriter
	statusCode int
	body       *bytes.Buffer
	wroteHdr   bool
}

func newResponseWriter(w http.ResponseWriter) *responseWriter {
	return &responseWriter{
		ResponseWriter: w,
		statusCode:     200,
		body:           &bytes.Buffer{},
	}
}

func (rw *responseWriter) WriteHeader(code int) {
	if !rw.wroteHdr {
		rw.statusCode = code
		rw.wroteHdr = true
		rw.ResponseWriter.WriteHeader(code)
	}
}

func (rw *responseWriter) Write(b []byte) (int, error) {
	if !rw.wroteHdr {
		rw.WriteHeader(200)
	}
	rw.body.Write(b)
	return rw.ResponseWriter.Write(b)
}

func HTTPMiddleware(serviceName string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
				next.ServeHTTP(w, r)
				return
			}

			taskID, sessionID := ExtractIDs(r)
			bodyBytes, _ := readBody(r)

			bodyTaskID, bodySessionID := ExtractIDsFromBody(bodyBytes)
			if bodyTaskID != "" {
				taskID = bodyTaskID
			}
			if bodySessionID != "" {
				sessionID = bodySessionID
			}

			logger := NewLogger(serviceName, WithTaskID(taskID), WithSessionID(sessionID))
			logger.LogRequest(r, bodyBytes)

			ctx := NewContext(r.Context(), logger)
			r = r.WithContext(ctx)

			start := time.Now()
			rw := newResponseWriter(w)
			next.ServeHTTP(rw, r)
			duration := time.Since(start)

			respBody := rw.body.Bytes()

			respTaskID, respSessionID := ExtractIDsFromRespBody(respBody)
			if respTaskID != "" || respSessionID != "" {
				logger.UpdateIDs(respTaskID, respSessionID)
			}

			if len(respBody) > 2000 {
				respBody = safeTruncateBytes(respBody, 2000)
			}

			logger.LogResponse(rw.statusCode, respBody, duration)
			logger.Close()
		})
	}
}

func readBody(r *http.Request) ([]byte, error) {
	if r.Body == nil || r.Body == http.NoBody {
		return nil, nil
	}

	ct := r.Header.Get("Content-Type")

	if strings.Contains(ct, "multipart/form-data") {
		return []byte("(multipart/form-data, 不记录内容)"), nil
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, err
	}
	r.Body.Close()
	r.Body = io.NopCloser(bytes.NewBuffer(body))
	return body, nil
}

func ExtractIDs(r *http.Request) (taskID, sessionID string) {
	taskID = r.Header.Get("X-Task-ID")
	sessionID = r.Header.Get("X-Session-ID")

	if v := pathParam(r.URL.Path, "task"); v != "" {
		taskID = v
	}
	if v := pathParam(r.URL.Path, "session"); v != "" {
		sessionID = v
	}

	if taskID == "" {
		taskID = "_unassigned"
	}
	if sessionID == "" {
		sessionID = "_task"
	}
	return
}

func pathParam(path string, segment string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	for i, p := range parts {
		if p == segment && i+1 < len(parts) {
			return parts[i+1]
		}
	}
	return ""
}

func safeTruncateBytes(b []byte, maxBytes int) []byte {
	if len(b) <= maxBytes {
		return b
	}
	i := maxBytes
	for i > 0 && i < len(b) && b[i]&0xC0 == 0x80 {
		i--
	}
	return b[:i]
}

func safeTruncateString(s string, maxBytes int) string {
	if len(s) <= maxBytes {
		return s
	}
	i := maxBytes
	for i > 0 && i < len(s) && s[i]&0xC0 == 0x80 {
		i--
	}
	return s[:i]
}
