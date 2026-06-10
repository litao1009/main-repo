package vault

import (
	"regexp"
	"strings"
)

const (
	UsernameMinLen = 3
	UsernameMaxLen = 32
)

// usernamePattern: 3–32 位，以字母或数字开头，仅含字母、数字、下划线、点、连字符（对齐常见 SaaS / IAM 账号命名）。
var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$`)

// ValidateUsername 校验用户名格式；通过时返回 trim 后的用户名。
func ValidateUsername(username string) (string, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return "", ErrInvalidUsername
	}
	if len(username) < UsernameMinLen || len(username) > UsernameMaxLen {
		return "", ErrInvalidUsername
	}
	if !usernamePattern.MatchString(username) {
		return "", ErrInvalidUsername
	}
	return username, nil
}
