-- 用户可选手机号（管理员创建/编辑时填写）
ALTER TABLE a1_users
  ADD COLUMN phone VARCHAR(32) DEFAULT NULL COMMENT '手机号（可选）';
