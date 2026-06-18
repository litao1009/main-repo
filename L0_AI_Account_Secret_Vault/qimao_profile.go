package vault

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

const (
	qimaoProfileURL  = "https://zuozhe.qimao.com/api/author/profile"
	qimaoUserInfoURL = "https://zuozhe.qimao.com/api/pc/v3/user/info"
)

// QimaoProfile 七猫作者资料解析结果（profile + user/info）。
type QimaoProfile struct {
	AccountID        string
	PenName          string
	Phone            string
	Avatar           string
	IsAuth           bool
	IdentityCodeMask string
}

// FetchQimaoProfile 用 Cookie 请求七猫作者资料接口。
func FetchQimaoProfile(ctx context.Context, cookieStr string) (*QimaoProfile, error) {
	cookieStr = strings.TrimSpace(cookieStr)
	if cookieStr == "" {
		return nil, fmt.Errorf("empty cookie")
	}

	reqCtx, cancel := context.WithTimeout(ctx, platformIdentityTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, qimaoProfileURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build qimao profile request: %w", err)
	}
	req.Header.Set("Cookie", cookieStr)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
	req.Header.Set("Referer", "https://zuozhe.qimao.com/front/index")
	req.Header.Set("Accept", "application/json, text/plain, */*")

	client := &http.Client{Timeout: platformIdentityTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("qimao profile request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("qimao profile http %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		return nil, fmt.Errorf("read qimao profile response: %w", err)
	}

	var result struct {
		Code int `json:"code"`
		Data struct {
			User struct {
				AccountID  json.RawMessage `json:"account_id"`
				PenName    string          `json:"pen_name"`
				Phone      string          `json:"phone"`
				Avatar     string          `json:"avatar"`
				RealStatus json.RawMessage `json:"real_status"`
			} `json:"user"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("parse qimao profile response: %w", err)
	}
	if result.Code != 200 {
		return nil, fmt.Errorf("qimao profile code=%d", result.Code)
	}

	u := result.Data.User
	accountID := parseQimaoStringField(u.AccountID)
	if accountID == "" {
		return nil, fmt.Errorf("qimao profile: account_id empty")
	}

	profile := &QimaoProfile{
		AccountID: accountID,
		PenName:   strings.TrimSpace(u.PenName),
		Phone:     strings.TrimSpace(u.Phone),
		Avatar:    strings.TrimSpace(u.Avatar),
		IsAuth:    parseQimaoRealStatus(u.RealStatus),
	}

	if isAuth, codeMask, err := fetchQimaoUserIdentity(reqCtx, cookieStr); err == nil {
		profile.IsAuth = isAuth
		if isAuth {
			profile.IdentityCodeMask = codeMask
		}
	}

	return profile, nil
}

func fetchQimaoUserIdentity(ctx context.Context, cookieStr string) (isAuth bool, identityCodeMask string, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, qimaoUserInfoURL, nil)
	if err != nil {
		return false, "", fmt.Errorf("build qimao user info request: %w", err)
	}
	req.Header.Set("Cookie", cookieStr)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
	req.Header.Set("Referer", "https://zuozhe.qimao.com/front/personal-information")
	req.Header.Set("Accept", "application/json, text/plain, */*")

	client := &http.Client{Timeout: platformIdentityTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return false, "", fmt.Errorf("qimao user info request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return false, "", fmt.Errorf("qimao user info http %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		return false, "", fmt.Errorf("read qimao user info response: %w", err)
	}

	var result struct {
		Data struct {
			RealStatus struct {
				Full  bool   `json:"full"`
				Value string `json:"value"`
			} `json:"real_status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return false, "", fmt.Errorf("parse qimao user info response: %w", err)
	}

	if !result.Data.RealStatus.Full {
		return false, "", nil
	}
	return true, strings.TrimSpace(result.Data.RealStatus.Value), nil
}

func parseQimaoStringField(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return strings.TrimSpace(s)
	}
	var n json.Number
	if err := json.Unmarshal(raw, &n); err == nil {
		return strings.TrimSpace(n.String())
	}
	return ""
}

func parseQimaoRealStatus(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return strings.TrimSpace(s) == "1"
	}
	var n int
	if err := json.Unmarshal(raw, &n); err == nil {
		return n == 1
	}
	return false
}
