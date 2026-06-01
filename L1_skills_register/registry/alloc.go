package registry

import (
	"context"
	"fmt"

	"L1_skills_register/models"
)

func (r *registryImpl) AllocSkill(ctx context.Context, platform, theme, style string, excludeIDs []string) ([]*models.AllocSkillResponse, error) {
	if platform == "" {
		return nil, fmt.Errorf("platform is required")
	}

	return r.store.AllocSkill(ctx, platform, theme, style, excludeIDs)
}

func (r *registryImpl) ReleaseSkill(ctx context.Context, skillID string) error {
	return r.store.ReleaseSkill(ctx, skillID)
}

func (r *registryImpl) AvailableCount(ctx context.Context, platform, theme, style string) (int, error) {
	return r.store.AvailableCount(ctx, platform, theme, style)
}
