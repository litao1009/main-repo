package logging

import "context"

type ctxKey struct{}

var loggerCtxKey = ctxKey{}

func FromContext(ctx context.Context) *Logger {
	if logger, ok := ctx.Value(loggerCtxKey).(*Logger); ok {
		return logger
	}
	return nil
}

func NewContext(ctx context.Context, logger *Logger) context.Context {
	return context.WithValue(ctx, loggerCtxKey, logger)
}
