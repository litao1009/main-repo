package logging

type ErrorCode int

const (
	ErrInternal          ErrorCode = 1000
	ErrInvalidParam      ErrorCode = 1001
	ErrUnauthorized      ErrorCode = 1002
	ErrNotFound          ErrorCode = 1003
	ErrDatabaseError     ErrorCode = 1004
	ErrExternalService   ErrorCode = 1005
	ErrTimeout           ErrorCode = 1006
	ErrRateLimited       ErrorCode = 1007
	ErrWorkflowError     ErrorCode = 1008
	ErrSessionError      ErrorCode = 1009
	ErrConfigError       ErrorCode = 1010
	ErrEncryptionError   ErrorCode = 1011
	ErrValidationError   ErrorCode = 1012
	ErrProxyError        ErrorCode = 1013
	ErrMarshalError      ErrorCode = 1014
	ErrIOError           ErrorCode = 1015
	ErrDraftNotReady     ErrorCode = 1016
	ErrPublishFailed     ErrorCode = 1017
	ErrPostMismatch      ErrorCode = 1018
)

const (
	WarnSlowResponse     ErrorCode = 2000
	WarnResourceUsage    ErrorCode = 2001
	WarnDeprecatedAPI    ErrorCode = 2002
	WarnServiceDegraded  ErrorCode = 2003
	WarnRetryAttempt     ErrorCode = 2004
	WarnLargePayload     ErrorCode = 2005
	WarnStaleSession     ErrorCode = 2006
	WarnProcessStuck     ErrorCode = 2007
)

var errorCodeMessages = map[ErrorCode]string{
	ErrInternal:          "内部服务错误",
	ErrInvalidParam:      "请求参数无效",
	ErrUnauthorized:      "未授权 / 鉴权失败",
	ErrNotFound:          "资源未找到",
	ErrDatabaseError:     "数据库操作失败",
	ErrTimeout:           "操作超时",
	ErrRateLimited:       "请求频率限制",
	ErrWorkflowError:     "工作流执行错误",
	ErrSessionError:      "会话管理错误",
	ErrConfigError:       "配置错误",
	ErrEncryptionError:   "加解密错误",
	ErrValidationError:   "数据校验错误",
	ErrProxyError:        "代理转发错误",
	ErrMarshalError:      "序列化错误",
	ErrIOError:           "IO 读写错误",
	ErrDraftNotReady:     "草稿尚未就绪",
	ErrPublishFailed:     "发布失败",
	ErrPostMismatch:      "发布结果不一致",
}

func ErrorCodeMessage(code ErrorCode) string {
	if msg, ok := errorCodeMessages[code]; ok {
		return msg
	}
	return "未知错误"
}

func ErrorCodeDescription(code ErrorCode) string {
	return ErrorCodeMessage(code)
}
