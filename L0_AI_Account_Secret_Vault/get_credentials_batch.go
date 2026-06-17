package vault

import "context"

func (v *RealSecretVault) GetCredentialsBatch(ctx context.Context, req GetCredentialsBatchRequest) (*GetCredentialsBatchResponse, error) {
	if req.Caller != v.c1CallerID {
		return nil, ErrUnauthorized
	}

	var results []CredentialsResult
	for _, accountID := range req.AccountIDs {
		credResp, err := v.GetCredentials(ctx, GetCredentialsRequest{
			AccountID: accountID,
			UID:       req.UID,
			Caller:    req.Caller,
		})
		if err != nil {
			results = append(results, CredentialsResult{
				AccountID: accountID,
				Error:     ErrorCode(err),
			})
			continue
		}
		results = append(results, CredentialsResult{
			AccountID:       credResp.AccountID,
			UID:             credResp.UID,
			Platform:        credResp.Platform,
			Credentials:     credResp.Credentials,
			SecurityWarning: credResp.SecurityWarning,
		})
	}

	return &GetCredentialsBatchResponse{Results: results}, nil
}
