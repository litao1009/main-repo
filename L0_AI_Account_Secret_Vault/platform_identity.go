package vault

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

const platformIdentityTimeout = 10 * time.Second

var zhulangWriterPageURL = "https://writer.zhulang.com/book/index.html"

var zhulangUIDPattern = regexp.MustCompile(`uid\s*:\s*"(\d+)"`)

// ResolvePlatformAuthorID 从凭证明文解析平台侧作者唯一标识。
// 番茄：account/info 接口的 mp_name（如 番茄2510925974999303）
// 逐浪：作家专区页面内嵌 uid（如 69108505）
// 七猫：/api/author/profile 的 account_id（如 2921296）
func ResolvePlatformAuthorID(ctx context.Context, platform, credentialsPlaintext string) (string, error) {
	credentialsPlaintext = strings.TrimSpace(credentialsPlaintext)
	if credentialsPlaintext == "" {
		return "", nil
	}

	switch platform {
	case "fanqie":
		return resolveFanqieAuthorID(ctx, credentialsPlaintext)
	case "zhulang":
		return resolveZhulangAuthorID(ctx, credentialsPlaintext)
	case "qimao":
		return resolveQimaoAuthorID(ctx, credentialsPlaintext)
	default:
		return "", nil
	}
}

func resolveFanqieAuthorID(ctx context.Context, cookieStr string) (string, error) {
	info, err := FetchFanqieAccountInfo(ctx, cookieStr)
	if err != nil {
		return "", err
	}

	if info.MPName != "" {
		return info.MPName, nil
	}

	if uidTT := strings.TrimSpace(parseCookieField(cookieStr, "uid_tt")); uidTT != "" {
		return "uid_tt:" + uidTT, nil
	}

	return "", fmt.Errorf("fanqie identity: mp_name and uid_tt both empty")
}

func resolveZhulangAuthorID(ctx context.Context, cookieStr string) (string, error) {
	reqCtx, cancel := context.WithTimeout(ctx, platformIdentityTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, zhulangWriterPageURL, nil)
	if err != nil {
		return "", fmt.Errorf("build zhulang identity request: %w", err)
	}
	req.Header.Set("Cookie", cookieStr)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
	req.Header.Set("Referer", "https://writer.zhulang.com/")

	client := &http.Client{Timeout: platformIdentityTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("zhulang identity probe failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("zhulang identity probe http %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
	if err != nil {
		return "", fmt.Errorf("read zhulang identity response: %w", err)
	}

	m := zhulangUIDPattern.FindSubmatch(body)
	if len(m) < 2 {
		return "", fmt.Errorf("zhulang identity: uid not found in writer page")
	}
	return string(m[1]), nil
}

func resolveQimaoAuthorID(ctx context.Context, cookieStr string) (string, error) {
	info, err := FetchQimaoProfile(ctx, cookieStr)
	if err != nil {
		return "", err
	}
	if info.AccountID == "" {
		return "", fmt.Errorf("qimao identity: account_id empty")
	}
	return info.AccountID, nil
}
