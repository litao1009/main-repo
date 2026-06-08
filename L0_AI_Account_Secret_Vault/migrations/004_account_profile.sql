-- 番茄等平台账号展示资料（与 credential 分离存储）
ALTER TABLE a1_credentials
  ADD COLUMN phone_number VARCHAR(32) DEFAULT NULL COMMENT '手机号（番茄等平台返回时已脱敏）',
  ADD COLUMN avatar_url VARCHAR(512) DEFAULT NULL COMMENT '头像绝对 URL',
  ADD COLUMN is_auth TINYINT(1) DEFAULT NULL COMMENT '是否实名认证：1=是，0=否';
