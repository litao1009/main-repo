-- 平台侧作者唯一标识（如番茄 mp_name、逐浪 uid），用于 account_id 跨解绑/再绑复用
ALTER TABLE a1_credentials
    ADD COLUMN platform_author_id VARCHAR(128) DEFAULT NULL COMMENT '平台作者唯一 ID' AFTER credential_fingerprint;

CREATE INDEX idx_platform_author ON a1_credentials (platform, platform_author_id);
CREATE INDEX idx_uid_platform_author ON a1_credentials (uid, platform, platform_author_id);
