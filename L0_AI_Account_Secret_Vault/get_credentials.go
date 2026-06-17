package vault

import (
	"context"
	"encoding/base64"
)

func (v *RealSecretVault) GetCredentials(ctx context.Context, req GetCredentialsRequest) (*GetCredentialsResponse, error) {
	if req.Caller != v.c1CallerID {
		v.audit.Record(ctx, AuditEntry{
			AccountID: req.AccountID,
			Action:    "get_credentials_denied",
			Caller:    req.Caller,
			Result:    "forbidden",
		})
		return nil, ErrUnauthorized
	}

	if req.UID == "" {
		v.audit.Record(ctx, AuditEntry{
			AccountID: req.AccountID,
			Action:    "get_credentials_denied",
			Caller:    req.Caller,
			Result:    "forbidden",
			ErrorCode: "MISSING_UID",
		})
		return nil, ErrInvalidInput
	}

	cred, err := v.store.FindByAccountID(ctx, req.AccountID)
	if err != nil {
		return nil, err
	}

	if cred.Credential == "" {
		return nil, ErrAccountNotFound
	}

	if cred.UID != req.UID {
		v.audit.Record(ctx, AuditEntry{
			AccountID: req.AccountID,
			Action:    "get_credentials_denied",
			Caller:    req.Caller,
			Result:    "forbidden",
			ErrorCode: "UID_MISMATCH",
		})
		return nil, ErrUnauthorized
	}

	ciphertext, err := base64.StdEncoding.DecodeString(cred.Credential)
	if err != nil {
		v.audit.Record(ctx, AuditEntry{
			AccountID: req.AccountID,
			Action:    "get_credentials",
			Caller:    req.Caller,
			Result:    "error",
			ErrorCode: ErrorCode(ErrDecryptFailed),
		})
		return nil, ErrDecryptFailed
	}

	plaintext, err := v.encryptor.Decrypt(ctx, ciphertext, "v1")
	if err != nil {
		v.audit.Record(ctx, AuditEntry{
			AccountID: req.AccountID,
			Action:    "get_credentials",
			Caller:    req.Caller,
			Result:    "error",
			ErrorCode: ErrorCode(err),
		})
		return nil, err
	}

	v.audit.Record(ctx, AuditEntry{
		AccountID: req.AccountID,
		Action:    "get_credentials",
		Caller:    req.Caller,
		Result:    "success",
	})

	return &GetCredentialsResponse{
		AccountID:       cred.AccountID,
		UID:             cred.UID,
		Platform:        cred.Platform,
		Credentials:     string(plaintext),
		MaskedDisplay:   cred.MaskedDisplay,
		SecurityWarning: "SENSITIVE: DO NOT LOG",
	}, nil
}

// GetCredentialForOwner 用户自取自己的凭证明文，仅校验 UID 归属，无 caller 限制。
// uid 为空时表示 admin 跳过归属校验，仅按 accountID 取凭证。
func (v *RealSecretVault) GetCredentialForOwner(ctx context.Context, accountID, uid string) (*GetCredentialsResponse, error) {
	if accountID == "" {
		return nil, ErrInvalidInput
	}

	cred, err := v.store.FindByAccountID(ctx, accountID)
	if err != nil {
		return nil, err
	}
	if cred == nil || cred.Credential == "" {
		return nil, ErrAccountNotFound
	}
	if uid != "" && cred.UID != uid {
		v.audit.Record(ctx, AuditEntry{
			AccountID: accountID,
			Action:    "get_credential_for_owner_denied",
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

	v.audit.Record(ctx, AuditEntry{
		AccountID: accountID,
		Action:    "get_credential_for_owner",
		Caller:    "bff",
		Result:    "success",
	})

	return &GetCredentialsResponse{
		AccountID:       cred.AccountID,
		UID:             cred.UID,
		Platform:        cred.Platform,
		Credentials:     string(plaintext),
		MaskedDisplay:   cred.MaskedDisplay,
		SecurityWarning: "SENSITIVE: DO NOT LOG",
	}, nil
}
