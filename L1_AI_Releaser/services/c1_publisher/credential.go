// Package c1_publisher 提供凭证获取与 SecurityWarning 校验。
package c1_publisher

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"clawstudios/l1_ai_releaser/services/a1_account"
)

const defaultA1BaseURL = "http://localhost:8084"

// A1Error A1 HTTP 接口返回的错误（A1 使用 PascalCase JSON）。
type A1Error struct {
	Code    string `json:"Code"`
	Message string `json:"Message"`
}

func (e *A1Error) Error() string {
	if e.Message != "" {
		return fmt.Sprintf("A1 %s: %s", e.Code, e.Message)
	}
	return fmt.Sprintf("A1 %s", e.Code)
}

// credFetchResult 凭证获取结果的封装。
type credFetchResult struct {
	resp *a1_account.GetCredentialsResponse
	err  error
}

// FetchCredential 通过 HTTP 从 A1 获取单条解密凭证。
//
// 强制约束：
//  1. Caller 必须为 "c1_publisher"
//  2. UID 必须传（归属校验）
//  3. SecurityWarning 必须检查
//  4. 返回的 credentials 不记日志
func FetchCredential(
	ctx context.Context,
	a1URL, accountID, uid string,
) (*a1_account.GetCredentialsResponse, error) {

	if a1URL == "" {
		a1URL = defaultA1BaseURL
	}

	reqBody := map[string]string{
		"account_id": accountID,
		"uid":        uid,
		"caller":     "c1_publisher",
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		a1URL+"/api/account/credentials", bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("A1 unreachable: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var a1Err A1Error
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		if json.Unmarshal(body, &a1Err) == nil && a1Err.Code != "" {
			return nil, &a1Err
		}
		return nil, fmt.Errorf("A1 returned HTTP %d", resp.StatusCode)
	}

	var credResp a1_account.GetCredentialsResponse
	if err := json.NewDecoder(resp.Body).Decode(&credResp); err != nil {
		return nil, fmt.Errorf("decode A1 response: %w", err)
	}

	if credResp.SecurityWarning != "SENSITIVE: DO NOT LOG" {
		logWarn("SecurityWarning field missing or tampered",
			"account_id", accountID,
			"expected", "SENSITIVE: DO NOT LOG",
			"actual", credResp.SecurityWarning,
		)
	}

	return &credResp, nil
}

// handleCredentialError 将 A1 GetCredentials 错误转为 PublishResult。
func handleCredentialError(accountID string, err error) *PublishResult {
	var a1Err *A1Error
	if errors.As(err, &a1Err) {
		switch a1Err.Code {
		case "UNAUTHORIZED":
			return &PublishResult{
				AccountID:    accountID,
				Status:       "fail",
				ErrorCode:    ErrCodeUnauthorized,
				ErrorMessage: "permission denied: caller or UID mismatch",
			}
		case "ACCOUNT_NOT_FOUND":
			return &PublishResult{
				AccountID:    accountID,
				Status:       "fail",
				ErrorCode:    ErrCodeAccountNotFound,
				ErrorMessage: "account not found or already unbound",
			}
		case "KMS_UNAVAILABLE":
			return &PublishResult{
				AccountID:    accountID,
				Status:       "fail",
				ErrorCode:    ErrCodeKMSUnavailable,
				ErrorMessage: "KMS service unavailable, retry later",
			}
		case "DECRYPT_FAILED":
			return &PublishResult{
				AccountID:    accountID,
				Status:       "fail",
				ErrorCode:    ErrCodeDecryptFailed,
				ErrorMessage: "credential decryption failed, data may be corrupted",
			}
		case "INVALID_INPUT":
			return &PublishResult{
				AccountID:    accountID,
				Status:       "fail",
				ErrorCode:    ErrCodeCredentialFailed,
				ErrorMessage: a1Err.Message,
			}
		}
	}
	return &PublishResult{
		AccountID:    accountID,
		Status:       "fail",
		ErrorCode:    ErrCodeCredentialFailed,
		ErrorMessage: fmt.Sprintf("failed to get credentials: %v", err),
	}
}
