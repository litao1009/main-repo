-- a1_credentials: 账号凭证主表
CREATE TABLE IF NOT EXISTS a1_credentials (
    account_id  VARCHAR(64)  NOT NULL PRIMARY KEY COMMENT '账号唯一标识，格式 acc_xxxxxxxx',
    uid         VARCHAR(64)  NOT NULL COMMENT '用户唯一标识',
    platform    VARCHAR(32)  NOT NULL COMMENT '平台标识: fanqie | wechat | douyin | bilibili | zhulang',
    credential  TEXT         NOT NULL COMMENT '加密后的凭证密文（Base64 编码）',
    credential_fingerprint VARCHAR(64) DEFAULT NULL COMMENT '凭证 SHA256 指纹（规范化后，用于绑定时去重）',
    platform_author_id VARCHAR(128) DEFAULT NULL COMMENT '平台作者唯一 ID（如番茄 mp_name、逐浪 uid）',
    masked_display VARCHAR(128) DEFAULT NULL COMMENT '脱敏展示名（同平台全局唯一）',
    phone_number VARCHAR(32) DEFAULT NULL COMMENT '手机号（番茄等平台返回时已脱敏）',
    avatar_url VARCHAR(512) DEFAULT NULL COMMENT '头像绝对 URL',
    is_auth TINYINT(1) DEFAULT NULL COMMENT '是否实名认证：1=是，0=否',
    identity_code_mask VARCHAR(32) DEFAULT NULL COMMENT '身份证号（脱敏，仅 is_auth=1 时有值）',
    identity_name_mask VARCHAR(64) DEFAULT NULL COMMENT '真实姓名（脱敏，仅 is_auth=1 时有值）',
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',

    UNIQUE KEY uk_account_id (account_id),
    INDEX idx_uid (uid),
    INDEX idx_platform (platform),
    INDEX idx_platform_fingerprint (platform, credential_fingerprint),
    INDEX idx_platform_author (platform, platform_author_id),
    INDEX idx_uid_platform_author (uid, platform, platform_author_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='账号凭证加密存储表';

-- a1_users: 用户表
CREATE TABLE IF NOT EXISTS a1_users (
    uid         VARCHAR(64)  NOT NULL PRIMARY KEY COMMENT '用户唯一标识',
    username    VARCHAR(128) NOT NULL COMMENT '用户名',
    password    VARCHAR(256) NOT NULL COMMENT 'bcrypt 密码哈希',
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '注册时间',
    updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
    UNIQUE KEY uk_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='用户认证表';

-- credential_audit_log: 凭证操作审计日志
CREATE TABLE IF NOT EXISTS credential_audit_log (
    id             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    account_id     VARCHAR(64)  NOT NULL COMMENT '关联的账号 ID',
    action         VARCHAR(32)  NOT NULL COMMENT '操作类型: bind | get_credentials | bind_denied | get_credentials_denied',
    caller         VARCHAR(128) NOT NULL COMMENT '调用方标识: bff | c1_publisher | admin_uid:xxx',
    result         VARCHAR(16)  NOT NULL COMMENT '操作结果: success | forbidden | error',
    error_code     VARCHAR(64)  DEFAULT NULL COMMENT '失败时的错误码，如 KMS_UNAVAILABLE',
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',

    INDEX idx_account_id (account_id),
    INDEX idx_created_at (created_at),
    INDEX idx_action (action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='凭证操作审计日志（不记录任何凭证内容）';
