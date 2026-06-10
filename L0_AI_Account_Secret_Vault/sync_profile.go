package vault

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"
	"time"
)

// SyncProfileRequest 同步账号资料请求（内部）。
type SyncProfileRequest struct {
	AccountID string
	UID       string
}

// SyncProfileResponse 同步后的账号资料摘要。
type SyncProfileResponse struct {
	AccountID        string `json:"account_id"`
	MaskedDisplay    string `json:"masked_display,omitempty"`
	PhoneNumber      string `json:"phone_number,omitempty"`
	AvatarURL        string `json:"avatar_url,omitempty"`
	IsAuth           bool   `json:"is_auth"`
	IdentityCodeMask string `json:"identity_code_mask,omitempty"`
	IdentityNameMask string `json:"identity_name_mask,omitempty"`
	SyncedAt         string `json:"synced_at"`
}

func mergeNonEmpty(current, incoming string) string {
	if strings.TrimSpace(incoming) != "" {
		return incoming
	}
	return current
}

func pickPlatformDisplayName(current, incoming string) string {
	incoming = strings.TrimSpace(incoming)
	if incoming != "" {
		return incoming
	}
	return current
}

func applyPlatformProfile(ctx context.Context, cred *AccountCredential, cookieStr string) error {
	phone := cred.PhoneNumber
	avatar := cred.AvatarURL
	isAuth := cred.IsAuth
	codeMask := cred.IdentityCodeMask
	nameMask := cred.IdentityNameMask
	displayName := cred.MaskedDisplay

	switch cred.Platform {
	case "fanqie":
		info, err := FetchFanqieAccountInfo(ctx, cookieStr)
		if err != nil {
			return fmt.Errorf("fetch fanqie profile: %w", err)
		}
		displayName = pickPlatformDisplayName(displayName, info.AuthorName)
		phone = mergeNonEmpty(phone, info.PhoneNumber)
		avatar = mergeNonEmpty(avatar, info.AvatarURL)
		isAuth = info.IsAuth
		if info.IsAuth {
			codeMask = mergeNonEmpty(codeMask, info.IdentityCodeMask)
			nameMask = mergeNonEmpty(nameMask, info.IdentityNameMask)
		} else {
			codeMask = ""
			nameMask = ""
		}
	case "zhulang":
		info, err := FetchZhulangProfile(ctx, cookieStr)
		if err != nil {
			return fmt.Errorf("fetch zhulang profile: %w", err)
		}
		displayName = pickPlatformDisplayName(displayName, info.PenName)
		phone = mergeNonEmpty(phone, info.PhoneNumber)
		avatar = mergeNonEmpty(avatar, info.AvatarURL)
		isAuth = info.IsAuth
		if info.IsAuth {
			codeMask = mergeNonEmpty(codeMask, info.IdentityCode)
			nameMask = mergeNonEmpty(nameMask, info.IdentityRealName)
		} else {
			codeMask = ""
			nameMask = ""
		}
	case "qimao":
		info, err := FetchQimaoProfile(ctx, cookieStr)
		if err != nil {
			return fmt.Errorf("fetch qimao profile: %w", err)
		}
		displayName = pickPlatformDisplayName(displayName, info.PenName)
		phone = mergeNonEmpty(phone, info.Phone)
		avatar = mergeNonEmpty(avatar, info.Avatar)
		isAuth = info.IsAuth
		codeMask = ""
		nameMask = ""
	default:
		return ErrPlatformNotSupported
	}

	cred.PhoneNumber = phone
	cred.AvatarURL = normalizeAvatarURLForPlatform(cred.Platform, avatar)
	cred.IsAuth = isAuth
	cred.IdentityCodeMask = codeMask
	cred.IdentityNameMask = nameMask
	cred.MaskedDisplay = strings.TrimSpace(displayName)
	return nil
}

func buildSyncProfileResponse(cred *AccountCredential, syncedAt time.Time) *SyncProfileResponse {
	return &SyncProfileResponse{
		AccountID:        cred.AccountID,
		MaskedDisplay:    cred.MaskedDisplay,
		PhoneNumber:      cred.PhoneNumber,
		AvatarURL:        cred.AvatarURL,
		IsAuth:           cred.IsAuth,
		IdentityCodeMask: cred.IdentityCodeMask,
		IdentityNameMask: cred.IdentityNameMask,
		SyncedAt:         syncedAt.Format(time.RFC3339),
	}
}

func isPlatformSessionRejected(platform string, err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	switch platform {
	case "fanqie", "qimao":
		return strings.Contains(msg, "code=") || strings.Contains(msg, " http ")
	case "zhulang":
		return strings.Contains(msg, "no author data found") || strings.Contains(msg, " http ")
	default:
		return true
	}
}

func hasPlatformSessionCookie(platform, cookieStr string) bool {
	switch platform {
	case "fanqie":
		return parseCookieField(cookieStr, "sessionid") != ""
	case "zhulang":
		return parseCookieField(cookieStr, "PHPSESSID") != ""
	default:
		return false
	}
}

// probeSessionAndApplyProfile 一次平台请求判断登录态，并在成功时写入 cred 的资料字段。
func probeSessionAndApplyProfile(ctx context.Context, cred *AccountCredential, cookieStr string) (valid bool, profileFetched bool, err error) {
	switch cred.Platform {
	case "fanqie", "zhulang", "qimao":
		if err := applyPlatformProfile(ctx, cred, cookieStr); err == nil {
			return true, true, nil
		}
		if isPlatformSessionRejected(cred.Platform, err) {
			return false, false, nil
		}
		if hasPlatformSessionCookie(cred.Platform, cookieStr) {
			return true, false, nil
		}
		return false, false, err
	default:
		valid, err := checkPlatformCookieExpiry(ctx, cred.Platform, cookieStr)
		return valid, false, err
	}
}

func (v *RealSecretVault) persistAccountProfile(ctx context.Context, cred *AccountCredential, auditAction string) (*SyncProfileResponse, error) {
	if cred.MaskedDisplay != "" {
		conflict, err := v.store.FindByDisplayName(ctx, cred.Platform, cred.MaskedDisplay, cred.AccountID)
		if err != nil {
			return nil, fmt.Errorf("check display name: %w", err)
		}
		if conflict != nil {
			return nil, ErrDuplicateDisplayName
		}
	}

	now := time.Now().UTC()
	cred.UpdatedAt = now

	if err := v.store.UpdateProfile(ctx, cred); err != nil {
		v.audit.Record(ctx, AuditEntry{
			AccountID: cred.AccountID,
			Action:    auditAction,
			Caller:    "bff",
			Result:    "error",
			ErrorCode: ErrorCode(err),
		})
		return nil, fmt.Errorf("update profile: %w", err)
	}

	v.audit.Record(ctx, AuditEntry{
		AccountID: cred.AccountID,
		Action:    auditAction,
		Caller:    "bff",
		Result:    "success",
	})

	return buildSyncProfileResponse(cred, now), nil
}

func (v *RealSecretVault) refreshAccountFromPlatform(ctx context.Context, accountID, uid, auditAction string) (*CheckCookieHealthResponse, error) {
	cred, err := v.store.FindAccountForSync(ctx, accountID)
	if err != nil {
		return nil, err
	}
	if cred.Credential == "" {
		return nil, ErrAccountNotFound
	}
	if uid != "" && cred.UID != uid {
		v.audit.Record(ctx, AuditEntry{
			AccountID: accountID,
			Action:    auditAction + "_denied",
			Caller:    "bff",
			Result:    "forbidden",
			ErrorCode: "UID_MISMATCH",
		})
		return nil, ErrUnauthorized
	}

	ciphertext, err := base64.StdEncoding.DecodeString(cred.Credential)
	if err != nil {
		return nil, ErrDecryptFailed
	}
	plaintext, err := v.encryptor.Decrypt(ctx, ciphertext, "v1")
	if err != nil {
		return nil, err
	}

	valid, profileFetched, err := probeSessionAndApplyProfile(ctx, cred, string(plaintext))
	checkedAt := time.Now().UTC()
	resp := &CheckCookieHealthResponse{
		AccountID: accountID,
		Valid:     valid,
		CheckedAt: checkedAt.Format(time.RFC3339),
	}
	if err != nil {
		return nil, err
	}
	if !valid || !profileFetched {
		return resp, nil
	}

	profile, err := v.persistAccountProfile(ctx, cred, auditAction)
	if err != nil {
		return nil, err
	}
	resp.Profile = profile
	return resp, nil
}

func (v *RealSecretVault) SyncAccountProfile(ctx context.Context, req SyncProfileRequest) (*SyncProfileResponse, error) {
	resp, err := v.refreshAccountFromPlatform(ctx, req.AccountID, req.UID, "sync_profile")
	if err != nil {
		return nil, err
	}
	if !resp.Valid {
		return nil, ErrInvalidCredentials
	}
	if resp.Profile == nil {
		return nil, ErrPlatformNotSupported
	}
	return resp.Profile, nil
}
