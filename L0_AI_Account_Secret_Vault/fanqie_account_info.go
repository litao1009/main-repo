package vault

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
)

var fanqieAvatarIDPattern = regexp.MustCompile(`(?i)novel-static/([a-f0-9]+)`)

// FanqieAccountInfo 番茄 /api/author/account/info/v0/ 返回的作者资料。
type FanqieAccountInfo struct {
	AuthorName  string `json:"author_name"`
	PhoneNumber string `json:"phone_number"`
	AvatarURL   string `json:"avatar_url"`
	IsAuth      bool   `json:"is_auth"`
	MPName      string `json:"mp_name"`
}

// FetchFanqieAccountInfo 用 Cookie 请求番茄作者账号信息接口。
func FetchFanqieAccountInfo(ctx context.Context, cookieStr string) (*FanqieAccountInfo, error) {
	cookieStr = strings.TrimSpace(cookieStr)
	if cookieStr == "" {
		return nil, fmt.Errorf("empty cookie")
	}

	reqCtx, cancel := context.WithTimeout(ctx, platformIdentityTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, fanqieCheckURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build fanqie account info request: %w", err)
	}
	req.Header.Set("Cookie", cookieStr)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
	req.Header.Set("Referer", "https://fanqienovel.com/main/writer/")
	req.Header.Set("Accept", "application/json, text/plain, */*")

	client := &http.Client{
		Timeout: platformIdentityTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fanqie account info probe failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fanqie account info probe http %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 16384))
	if err != nil {
		return nil, fmt.Errorf("read fanqie account info response: %w", err)
	}

	var result struct {
		Code int `json:"code"`
		Data struct {
			AuthorName  string          `json:"author_name"`
			PhoneNumber string          `json:"phone_number"`
			AvatarURL   string          `json:"avatar_url"`
			IsAuth      json.RawMessage `json:"is_auth"`
			MPName      string          `json:"mp_name"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("parse fanqie account info response: %w", err)
	}
	if result.Code != 0 {
		return nil, fmt.Errorf("fanqie account info probe code=%d", result.Code)
	}

	return &FanqieAccountInfo{
		AuthorName:  strings.TrimSpace(result.Data.AuthorName),
		PhoneNumber: strings.TrimSpace(result.Data.PhoneNumber),
		AvatarURL:   NormalizeFanqieAvatarURL(strings.TrimSpace(result.Data.AvatarURL)),
		IsAuth:      parseFanqieIsAuth(result.Data.IsAuth),
		MPName:      strings.TrimSpace(result.Data.MPName),
	}, nil
}

// NormalizeFanqieAvatarURL 将番茄私有 CDN 头像链接转为可公开访问的 byteimg 地址。
func NormalizeFanqieAvatarURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if strings.Contains(raw, "byteimg.com") {
		return raw
	}
	if m := fanqieAvatarIDPattern.FindStringSubmatch(raw); len(m) > 1 {
		return "https://p3-novel.byteimg.com/img/novel-static/" + m[1] + "~tplv-obj.image"
	}
	if strings.HasPrefix(raw, "/") {
		return "https://fanqienovel.com" + raw
	}
	return raw
}

func parseFanqieIsAuth(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false
	}
	var b bool
	if err := json.Unmarshal(raw, &b); err == nil {
		return b
	}
	var n int
	if err := json.Unmarshal(raw, &n); err == nil {
		return n != 0
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		s = strings.TrimSpace(s)
		return s == "1" || strings.EqualFold(s, "true")
	}
	return false
}
