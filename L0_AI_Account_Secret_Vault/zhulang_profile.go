package vault

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
)

const zhulangAuthorPageURL = "https://writer.zhulang.com/author/index.html"

var (
	zhulangJSStringFieldPattern = regexp.MustCompile(`(?m)([A-Za-z_]+)\s*:\s*'([^']*)'`)
	zhulangAvatarPattern        = regexp.MustCompile(`avatar\s*:\s*"([^"]+)"`)
)

// ZhulangProfile 逐浪作家资料页内嵌数据解析结果。
type ZhulangProfile struct {
	PenName          string
	PhoneNumber      string
	AvatarURL        string
	IsAuth           bool
	IdentityCode     string
	IdentityRealName string
}

// FetchZhulangProfile 用 Cookie 请求逐浪作家资料页并解析 dftInfoData / zluser。
func FetchZhulangProfile(ctx context.Context, cookieStr string) (*ZhulangProfile, error) {
	cookieStr = strings.TrimSpace(cookieStr)
	if cookieStr == "" {
		return nil, fmt.Errorf("empty cookie")
	}

	reqCtx, cancel := context.WithTimeout(ctx, platformIdentityTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, zhulangAuthorPageURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build zhulang profile request: %w", err)
	}
	req.Header.Set("Cookie", cookieStr)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
	req.Header.Set("Referer", "https://writer.zhulang.com/")

	client := &http.Client{Timeout: platformIdentityTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("zhulang profile request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("zhulang profile http %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if err != nil {
		return nil, fmt.Errorf("read zhulang profile response: %w", err)
	}

	fields := parseZhulangJSFields(body)
	penname := strings.TrimSpace(fields["penname"])
	phone := strings.TrimSpace(fields["phone"])
	realname := strings.TrimSpace(fields["realname"])
	identityCode := strings.TrimSpace(fields["ID"])
	isAuth := realname != "" && identityCode != ""

	avatar := ""
	if m := zhulangAvatarPattern.FindSubmatch(body); len(m) > 1 {
		avatar = strings.TrimSpace(string(m[1]))
	}

	if penname == "" && phone == "" && avatar == "" && !isAuth {
		return nil, fmt.Errorf("zhulang profile: no author data found")
	}

	return &ZhulangProfile{
		PenName:          penname,
		PhoneNumber:      phone,
		AvatarURL:        avatar,
		IsAuth:           isAuth,
		IdentityCode:     identityCode,
		IdentityRealName: realname,
	}, nil
}

func parseZhulangJSFields(body []byte) map[string]string {
	out := make(map[string]string)
	for _, m := range zhulangJSStringFieldPattern.FindAllSubmatch(body, -1) {
		if len(m) < 3 {
			continue
		}
		key := string(m[1])
		if key == "penname" || key == "phone" || key == "realname" || key == "ID" {
			out[key] = string(m[2])
		}
	}
	return out
}
