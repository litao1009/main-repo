-- 番茄实名脱敏信息（仅 is_auth=1 时有值）
ALTER TABLE a1_credentials
  ADD COLUMN identity_code_mask VARCHAR(32) DEFAULT NULL COMMENT '身份证号（脱敏）',
  ADD COLUMN identity_name_mask VARCHAR(64) DEFAULT NULL COMMENT '真实姓名（脱敏）';
