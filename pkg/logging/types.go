package logging

type Level string

const (
	LevelInfo  Level = "INFO"
	LevelWarn  Level = "WARN"
	LevelError Level = "ERROR"
)

type ServiceInfo struct {
	Name string
	Port string
	Desc string
}

type LogEntry struct {
	Timestamp string `json:"timestamp"`
	Level     Level  `json:"level"`
	Service   string `json:"service"`
	TaskID    string `json:"task_id"`
	SessionID string `json:"session_id"`
	Message   string `json:"message"`
	Detail    string `json:"detail,omitempty"`
	ErrorCode int    `json:"error_code,omitempty"`
	Duration  string `json:"duration,omitempty"`
}
