package logging

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	logRoot    = "/tmp/logs"
	timeFormat = "2006-01-02 15:04:05.000"
)

var (
	serviceOrderMu sync.Mutex
	serviceOrders  = map[string]int{}
	nextOrder      = 0
)

func registerService(name string) int {
	serviceOrderMu.Lock()
	defer serviceOrderMu.Unlock()
	if idx, ok := serviceOrders[name]; ok {
		return idx
	}
	serviceOrders[name] = nextOrder
	nextOrder++
	return serviceOrders[name]
}

type Logger struct {
	mu           sync.Mutex
	taskID       string
	sessionID    string
	serviceName  string
	serviceOrder int
	filePath     string
	file         *os.File
	startTime    time.Time
	infoCount    int
	warnCount    int
	errorCount   int
	headerDone   bool
	buffer       []string
}

type Option func(*Logger)

func WithTaskID(id string) Option {
	return func(l *Logger) {
		if id != "" {
			l.taskID = id
		}
	}
}

func WithSessionID(id string) Option {
	return func(l *Logger) {
		if id != "" {
			l.sessionID = id
		}
	}
}

func NewLogger(serviceName string, opts ...Option) *Logger {
	order := registerService(serviceName)
	l := &Logger{
		taskID:       "_unassigned",
		sessionID:    fmt.Sprintf("req_%d", time.Now().UnixNano()),
		serviceName:  serviceName,
		serviceOrder: order,
		startTime:    time.Now(),
	}

	for _, o := range opts {
		o(l)
	}

	return l
}

func (l *Logger) UpdateIDs(taskID, sessionID string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if taskID != "" && taskID != "_unassigned" {
		l.taskID = taskID
	}
	if sessionID != "" {
		l.sessionID = sessionID
	}
}

func (l *Logger) logFilePath() string {
	safeTask := sanitizePath(l.taskID)
	safeSess := sanitizePath(l.sessionID)
	return filepath.Join(logRoot, safeTask, safeSess+".log")
}

func (l *Logger) initFile() error {
	if l.file != nil {
		return nil
	}

	dir := filepath.Join(logRoot, sanitizePath(l.taskID))
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create log dir: %w", err)
	}

	l.filePath = l.logFilePath()

	f, err := os.OpenFile(l.filePath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return fmt.Errorf("open log file: %w", err)
	}
	l.file = f
	return nil
}

func (l *Logger) writeHeader() {
	if l.headerDone {
		return
	}
	l.headerDone = true

	fi, err := l.file.Stat()
	if err != nil {
		return
	}

	if fi.Size() == 0 {
		l.file.WriteString(buildFileHeader(l.taskID, l.sessionID))
	}

	serviceHeader := buildServiceHeader(l.serviceName, l.serviceOrder)
	l.file.WriteString(serviceHeader)
}

func (l *Logger) Begin() error {
	return nil
}

func (l *Logger) LogRequest(r *http.Request, body []byte) {
	l.mu.Lock()
	defer l.mu.Unlock()

	ts := time.Now().Format(timeFormat)
	sb := &strings.Builder{}

	sb.WriteString(fmt.Sprintf("[%s] [INFO] [%s] >>> 请求进入\n", ts, l.serviceName))
	sb.WriteString(fmt.Sprintf("  ├─ Method: %s\n", r.Method))
	sb.WriteString(fmt.Sprintf("  ├─ Path:   %s", r.URL.Path))
	if r.URL.RawQuery != "" {
		sb.WriteString(fmt.Sprintf("?%s", r.URL.RawQuery))
	}
	sb.WriteString("\n")
	sb.WriteString(fmt.Sprintf("  ├─ Remote: %s\n", r.RemoteAddr))

	if ct := r.Header.Get("Content-Type"); ct != "" {
		sb.WriteString(fmt.Sprintf("  ├─ Content-Type: %s\n", ct))
	}
	if tid := r.Header.Get("X-Trace-ID"); tid != "" {
		sb.WriteString(fmt.Sprintf("  ├─ Trace-ID: %s\n", tid))
	}
	if uid := r.Header.Get("X-User-ID"); uid != "" {
		sb.WriteString(fmt.Sprintf("  ├─ User-ID: %s\n", uid))
	}

	if len(body) > 0 {
		bodyStr := string(body)
		if len(bodyStr) > 2000 {
			bodyStr = safeTruncateString(bodyStr, 2000) + "...(已截断,总长 " + itoa(len(body)) + " bytes)"
		}
		sb.WriteString(fmt.Sprintf("  └─ Body: %s\n", bodyStr))
	} else {
		sb.WriteString("  └─ Body: (无请求体)\n")
	}

	sb.WriteString("\n")
	l.infoCount++
	l.buffer = append(l.buffer, sb.String())
}

func (l *Logger) LogResponse(statusCode int, respBody []byte, duration time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()

	ts := time.Now().Format(timeFormat)
	level := LevelInfo
	if statusCode >= 500 {
		level = LevelError
	} else if statusCode >= 400 {
		level = LevelWarn
	}

	sb := &strings.Builder{}
	statusText := fmt.Sprintf("%d %s", statusCode, http.StatusText(statusCode))
	durMs := fmt.Sprintf("%.2fms", float64(duration.Microseconds())/1000.0)

	sb.WriteString(fmt.Sprintf("[%s] [%s] [%s] <<< 响应返回 | %s | 耗时: %s\n", ts, level, l.serviceName, statusText, durMs))

	if len(respBody) > 0 {
		bodyStr := string(respBody)
		if len(bodyStr) > 2000 {
			bodyStr = safeTruncateString(bodyStr, 2000) + "...(已截断,总长 " + itoa(len(respBody)) + " bytes)"
		}
		sb.WriteString(fmt.Sprintf("  └─ Body: %s\n", bodyStr))
	} else {
		sb.WriteString("  └─ Body: (空响应)\n")
	}

	sb.WriteString("\n")

	switch level {
	case LevelInfo:
		l.infoCount++
	case LevelWarn:
		l.warnCount++
	case LevelError:
		l.errorCount++
	}

	l.buffer = append(l.buffer, sb.String())
}

func (l *Logger) Info(format string, args ...interface{}) {
	l.writeEntry(LevelInfo, 0, format, args...)
}

func (l *Logger) Warn(code ErrorCode, format string, args ...interface{}) {
	l.writeEntry(LevelWarn, code, format, args...)
}

func (l *Logger) Error(code ErrorCode, format string, args ...interface{}) {
	l.writeEntry(LevelError, code, format, args...)
}

func (l *Logger) writeEntry(level Level, code ErrorCode, format string, args ...interface{}) {
	l.mu.Lock()
	defer l.mu.Unlock()

	ts := time.Now().Format(timeFormat)
	msg := fmt.Sprintf(format, args...)

	sb := &strings.Builder{}
	tag := ""

	switch level {
	case LevelWarn:
		tag = "⚠"
		l.warnCount++
	case LevelError:
		tag = "✗"
		l.errorCount++
	default:
		tag = "✓"
		l.infoCount++
	}

	sb.WriteString(fmt.Sprintf("[%s] [%s] [%s] %s %s\n", ts, level, l.serviceName, tag, msg))
	if code != 0 {
		sb.WriteString(fmt.Sprintf("  └─ Code: %d — %s\n", int(code), ErrorCodeMessage(code)))
	}
	sb.WriteString("\n")
	l.buffer = append(l.buffer, sb.String())
}

func (l *Logger) LogProxyCall(upstream string, method string, body []byte, respStatus int, respBody []byte, duration time.Duration, err error) {
	l.mu.Lock()
	defer l.mu.Unlock()

	ts := time.Now().Format(timeFormat)

	sb := &strings.Builder{}

	if err != nil {
		l.errorCount++
		sb.WriteString(fmt.Sprintf("[%s] [ERROR] [%s] ✗ 下游调用失败 | %s %s\n", ts, l.serviceName, method, upstream))
		sb.WriteString(fmt.Sprintf("  ├─ Error: %v\n", err))
		if len(body) > 0 {
			bodyStr := string(body)
			if len(bodyStr) > 500 {
				bodyStr = safeTruncateString(bodyStr, 500) + "..."
			}
			sb.WriteString(fmt.Sprintf("  └─ 请求体: %s\n", bodyStr))
		}
	} else {
		level := LevelInfo
		if respStatus >= 500 {
			level = LevelError
			l.errorCount++
		} else if respStatus >= 400 {
			level = LevelWarn
			l.warnCount++
		} else {
			l.infoCount++
		}

		durMs := fmt.Sprintf("%.2fms", float64(duration.Microseconds())/1000.0)
		sb.WriteString(fmt.Sprintf("[%s] [%s] [%s] → 下游调用 | %s %s | %d | %s\n", ts, level, l.serviceName, method, upstream, respStatus, durMs))
		if len(respBody) > 0 {
			bodyStr := string(respBody)
			if len(bodyStr) > 1000 {
				bodyStr = safeTruncateString(bodyStr, 1000) + "..."
			}
			sb.WriteString(fmt.Sprintf("  └─ 响应体: %s\n", bodyStr))
		}
	}

	sb.WriteString("\n")
	l.buffer = append(l.buffer, sb.String())
}

func (l *Logger) Close() {
	l.mu.Lock()
	defer l.mu.Unlock()

	if l.file != nil {
		return
	}

	if err := l.initFile(); err != nil {
		return
	}

	l.writeHeader()

	fileHeaderSize := int64(0)
	fi, _ := l.file.Stat()
	fileHeaderSize = fi.Size()

	for _, entry := range l.buffer {
		l.file.WriteString(entry)
	}

	duration := time.Since(l.startTime)
	ts := time.Now().Format(timeFormat)
	footer := buildServiceFooter(l.serviceName, ts, duration, l.infoCount, l.warnCount, l.errorCount)
	l.file.WriteString(footer)
	l.file.Close()
	l.file = nil

	_ = fileHeaderSize
}

func (l *Logger) SessionSummary(w io.Writer) {
	total := l.infoCount + l.warnCount + l.errorCount
	fmt.Fprintf(w, "Task=%s Session=%s Service=%s 日志: %d | 预警: %d | 错误: %d | 共: %d | 耗时: %s\n",
		l.taskID, l.sessionID, l.serviceName,
		l.infoCount, l.warnCount, l.errorCount, total,
		time.Since(l.startTime).Round(time.Millisecond).String(),
	)
}

func sanitizePath(s string) string {
	s = strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r == ':' || r == '*' || r == '?' || r == '"' || r == '<' || r == '>' || r == '|' {
			return '_'
		}
		if r < 32 {
			return '_'
		}
		return r
	}, s)
	if len(s) > 128 {
		s = s[:128]
	}
	return s
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var digits []byte
	neg := n < 0
	if neg {
		n = -n
	}
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	if neg {
		digits = append([]byte{'-'}, digits...)
	}
	return string(digits)
}

func buildFileHeader(taskID, sessionID string) string {
	ts := time.Now().Format(timeFormat)
	return fmt.Sprintf(`╔══════════════════════════════════════════════════════════════════════════════╗
║  SESSION LOG
║  Task ID:    %s
║  Session ID: %s
║  Created:    %s
╚══════════════════════════════════════════════════════════════════════════════╝

`, taskID, sessionID, ts)
}

func buildServiceHeader(serviceName string, order int) string {
	ts := time.Now().Format(timeFormat)
	return fmt.Sprintf(`┌──────────────────────────────────────────────────────────────────────────────┐
│ 服务: %s (#%d)                        开始时间: %s
└──────────────────────────────────────────────────────────────────────────────┘

`, serviceName, order, ts)
}

func buildServiceFooter(serviceName, ts string, duration time.Duration, info, warn, errCount int) string {
	return fmt.Sprintf(`┌──────────────────────────────────────────────────────────────────────────────┐
│ 服务: %s 处理完毕                                      结束时间: %s
│ 耗时: %s  |  日志: %d  |  预警: %d  |  错误: %d
└──────────────────────────────────────────────────────────────────────────────┘

`, serviceName, ts, duration.Round(time.Millisecond).String(), info, warn, errCount)
}

func ListSessions(taskID string) ([]string, error) {
	safeTask := sanitizePath(taskID)
	taskDir := filepath.Join(logRoot, safeTask)

	entries, err := os.ReadDir(taskDir)
	if err != nil {
		return nil, err
	}

	var sessions []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".log") {
			sessions = append(sessions, strings.TrimSuffix(e.Name(), ".log"))
		}
	}
	sort.Strings(sessions)
	return sessions, nil
}
