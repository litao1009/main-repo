package vault

import (
	"context"
	"database/sql"
	"fmt"
)

// RealSecretVault 是 SecretVault 的真实实现，组装所有组件。
type RealSecretVault struct {
	cfg          *Config
	encryptor    Encryptor
	store        *CredentialStore
	userStore    *UserStore
	audit        *AuditWriter
	adminAudit   *AdminAuditWriter
	c1CallerID   string
}

func NewRealSecretVault(cfg *Config) (*RealSecretVault, error) {
	db, err := sql.Open("mysql", cfg.DSN())
	if err != nil {
		return nil, err
	}

	db.SetMaxOpenConns(cfg.DBMaxOpenConns)
	db.SetMaxIdleConns(cfg.DBMaxIdleConns)
	db.SetConnMaxLifetime(cfg.DBConnMaxLifetime)

	enc, err := NewEncryptor(cfg)
	if err != nil {
		db.Close()
		return nil, err
	}

	return &RealSecretVault{
		cfg:          cfg,
		encryptor:    enc,
		store:        NewCredentialStore(db),
		userStore:    NewUserStore(db),
		audit:        NewAuditWriter(db, cfg.AuditEnabled),
		adminAudit:   NewAdminAuditWriter(db, cfg.AuditEnabled),
		c1CallerID:   cfg.C1CallerIdentifier,
	}, nil
}

func (v *RealSecretVault) Health(ctx context.Context) error {
	return v.encryptor.Health(ctx)
}

// CheckCookieHealth 检测 Cookie 是否有效；对番茄/逐浪/七猫一次请求同时同步资料。
func (v *RealSecretVault) CheckCookieHealth(ctx context.Context, req CheckCookieHealthRequest) (*CheckCookieHealthResponse, error) {
	return v.refreshAccountFromPlatform(ctx, req.AccountID, req.UID, "check_cookie_health")
}

func (v *RealSecretVault) Register(ctx context.Context, username, password, role, phone string) (*User, error) {
	return v.userStore.Create(ctx, username, password, role, phone)
}

func (v *RealSecretVault) Login(ctx context.Context, username, password string) (*User, error) {
	return v.userStore.Authenticate(ctx, username, password)
}

func (v *RealSecretVault) ListUsers(ctx context.Context, page, size int, priorityUID string) ([]AdminUserInfo, int, error) {
	return v.userStore.ListUsers(ctx, page, size, priorityUID)
}

func (v *RealSecretVault) UpdateUser(ctx context.Context, uid, password, role string, phone *string, operatorUID string) error {
	return v.userStore.UpdateUser(ctx, uid, password, role, phone, operatorUID)
}

func (v *RealSecretVault) GetUserByUID(ctx context.Context, uid string) (*User, error) {
	return v.userStore.FindByUID(ctx, uid)
}

func (v *RealSecretVault) DeleteUser(ctx context.Context, uid, operatorUID string) error {
	return v.userStore.DeleteUser(ctx, uid, operatorUID)
}

func (v *RealSecretVault) RecordAdminAudit(ctx context.Context, operatorUID, action, targetUID, detail string) {
	v.adminAudit.Record(ctx, operatorUID, action, targetUID, detail)
}

func (v *RealSecretVault) Close() error {
	return v.encryptor.Close()
}

// DSN 返回 MySQL 连接串。
func (c *Config) DSN() string {
	return fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?parseTime=true&charset=utf8mb4&loc=Asia%%2FShanghai",
		c.DBUser, c.DBPassword, c.DBHost, c.DBPort, c.DBName)
}
