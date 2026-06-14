-- schema_xlongxia.sql
-- xlongxia 数据库初始化脚本（幂等，可重复执行）
-- 使用: mysql -u root -p < schema_xlongxia.sql

CREATE DATABASE IF NOT EXISTS xlongxia
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE xlongxia;

-- a1_credentials: 平台账号凭证加密存储表
CREATE TABLE IF NOT EXISTS `a1_credentials` (
  `account_id` varchar(64) NOT NULL,
  `uid` varchar(64) NOT NULL,
  `platform` varchar(32) NOT NULL,
  `credential` text NOT NULL,
  `credential_fingerprint` varchar(64) DEFAULT NULL COMMENT 'SHA256 指纹',
  `platform_author_id` varchar(128) DEFAULT NULL COMMENT '平台作者唯一 ID',
  `masked_display` varchar(128) DEFAULT '',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `phone_number` varchar(32) DEFAULT NULL,
  `avatar_url` varchar(512) DEFAULT NULL,
  `is_auth` tinyint(1) DEFAULT NULL COMMENT '1=已实名 0=未实名',
  `identity_code_mask` varchar(32) DEFAULT NULL COMMENT '身份证脱敏',
  `identity_name_mask` varchar(64) DEFAULT NULL COMMENT '姓名脱敏',
  PRIMARY KEY (`account_id`),
  UNIQUE KEY `uk_account_id` (`account_id`),
  KEY `idx_uid` (`uid`),
  KEY `idx_platform` (`platform`),
  KEY `idx_platform_fingerprint` (`platform`,`credential_fingerprint`),
  KEY `idx_platform_author` (`platform`,`platform_author_id`),
  KEY `idx_uid_platform_author` (`uid`,`platform`,`platform_author_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- a1_users: 用户认证表
CREATE TABLE IF NOT EXISTS `a1_users` (
  `uid` varchar(64) NOT NULL COMMENT '用户唯一标识',
  `username` varchar(128) NOT NULL COMMENT '用户名',
  `password` varchar(256) NOT NULL COMMENT 'bcrypt 密码哈希',
  `role` varchar(16) NOT NULL DEFAULT 'user',
  `password_changed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `last_login_at` datetime DEFAULT NULL,
  `phone` varchar(32) DEFAULT NULL,
  PRIMARY KEY (`uid`),
  UNIQUE KEY `uk_username` (`username`),
  UNIQUE KEY `uk_phone` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- admin_audit_log: 管理员操作审计日志
CREATE TABLE IF NOT EXISTS `admin_audit_log` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `operator` varchar(64) NOT NULL,
  `action` varchar(32) NOT NULL,
  `target_uid` varchar(64) NOT NULL,
  `detail` varchar(256) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_operator` (`operator`),
  KEY `idx_target` (`target_uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- credential_audit_log: 凭证操作审计日志
CREATE TABLE IF NOT EXISTS `credential_audit_log` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `account_id` varchar(64) NOT NULL,
  `action` varchar(32) NOT NULL,
  `caller` varchar(128) NOT NULL,
  `result` varchar(16) NOT NULL,
  `error_code` varchar(64) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_account_id` (`account_id`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- platform_stats: 平台发布数据统计
CREATE TABLE IF NOT EXISTS `platform_stats` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `post_id` varchar(255) NOT NULL,
  `platform` varchar(64) NOT NULL,
  `views` int DEFAULT '0',
  `likes` int DEFAULT '0',
  `comments` int DEFAULT '0',
  `shares` int DEFAULT '0',
  `snapshot_at` timestamp NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_post_id` (`post_id`),
  KEY `idx_snapshot` (`snapshot_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- publish_record: 发布记录表
CREATE TABLE IF NOT EXISTS `publish_record` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `task_id` varchar(64) NOT NULL,
  `account_id` varchar(64) NOT NULL,
  `uid` varchar(64) NOT NULL,
  `platform` varchar(32) NOT NULL,
  `content_hash` char(64) NOT NULL DEFAULT '',
  `status` varchar(16) NOT NULL,
  `post_id` varchar(128) NOT NULL DEFAULT '',
  `error_code` varchar(64) NOT NULL DEFAULT '',
  `error_msg` text NOT NULL,
  `called_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `published_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `skill_id` varchar(64) DEFAULT NULL,
  `session_id` varchar(64) DEFAULT NULL,
  `novel_name` varchar(128) DEFAULT '' COMMENT '作品名',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_task_account_platform` (`task_id`,`account_id`,`platform`),
  KEY `idx_post_id` (`post_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- workflow_task: Workflow Engine 发布流水线任务表
CREATE TABLE IF NOT EXISTS `workflow_task` (
  `task_id` varchar(64) NOT NULL COMMENT '任务唯一标识',
  `uid` varchar(64) NOT NULL COMMENT '用户 ID',
  `skill_id` varchar(64) DEFAULT '' COMMENT 'Skill ID',
  `topic` varchar(512) DEFAULT '' COMMENT '任务主题',
  `novel_name` varchar(256) DEFAULT '',
  `title` varchar(256) DEFAULT '',
  `volume_name` varchar(128) DEFAULT '',
  `chapter_number` int DEFAULT '0',
  `platform` varchar(32) NOT NULL COMMENT '目标平台',
  `status` enum('init','fetch_draft','publishing','published','md_writing','md_written','done','done_partial','failed_gen','failed_md','published_failed') NOT NULL DEFAULT 'init',
  `session_id` varchar(64) NOT NULL COMMENT 'Agent Session ID',
  `draft_version` int DEFAULT '0',
  `draft_hash` varchar(128) DEFAULT '',
  `md_path` varchar(512) DEFAULT '' COMMENT 'MD 档案路径',
  `trace_id` varchar(64) DEFAULT '' COMMENT '全链路 Trace ID',
  `publish_results` json DEFAULT NULL COMMENT '发布结果 JSON 数组',
  `current_step` varchar(32) DEFAULT '' COMMENT '当前执行步骤',
  `step_retry` int DEFAULT '0' COMMENT '当前步骤重试次数',
  `step_updated_at` timestamp NULL DEFAULT NULL COMMENT '步骤更新时间',
  `error_msg` text COMMENT '错误信息',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `accounts` json DEFAULT NULL,
  PRIMARY KEY (`task_id`),
  KEY `idx_status` (`status`),
  KEY `idx_recover` (`status`,`step_updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
