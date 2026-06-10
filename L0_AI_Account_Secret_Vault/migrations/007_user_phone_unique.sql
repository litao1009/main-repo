-- 手机号唯一（允许多个 NULL），支持手机号登录
ALTER TABLE a1_users
  ADD UNIQUE KEY uk_phone (phone);
