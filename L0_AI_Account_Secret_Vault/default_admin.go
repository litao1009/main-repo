package vault

import (
	"context"
	"fmt"
)

const (
	DefaultAdminUsername = "admin"
	DefaultAdminPassword = "admin123"
)

// EnsureDefaultAdmin 在系统中没有任何管理员时创建默认管理员账号。
// 用于全新部署或数据库清空后仍能登录管理后台。
func (s *UserStore) EnsureDefaultAdmin(ctx context.Context) (bool, error) {
	var adminCount int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM a1_users WHERE role = 'admin'`).Scan(&adminCount); err != nil {
		return false, fmt.Errorf("count admins: %w", err)
	}
	if adminCount > 0 {
		return false, nil
	}

	existing, err := s.FindByUsername(ctx, DefaultAdminUsername)
	if err != nil {
		return false, err
	}
	if existing != nil {
		return false, nil
	}

	if _, err := s.Create(ctx, DefaultAdminUsername, DefaultAdminPassword, "admin", ""); err != nil {
		return false, fmt.Errorf("create default admin: %w", err)
	}
	return true, nil
}
