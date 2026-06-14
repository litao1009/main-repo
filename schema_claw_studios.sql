-- schema_claw_studios.sql
-- claw_studios 数据库初始化脚本（幂等，可重复执行）
-- 使用: mysql -u root -p < schema_claw_studios.sql

CREATE DATABASE IF NOT EXISTS claw_studios
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE claw_studios;

-- auto_publish_task: 自动发布任务表
CREATE TABLE IF NOT EXISTS `auto_publish_task` (
  `task_id` varchar(64) NOT NULL,
  `user_id` varchar(64) NOT NULL,
  `account_ids` varchar(1024) DEFAULT '',
  `platform` varchar(32) NOT NULL DEFAULT 'fanqie',
  `work_id` varchar(64) DEFAULT '',
  `skill_id` varchar(64) NOT NULL,
  `topic` varchar(512) DEFAULT '',
  `novel_name` varchar(256) DEFAULT '',
  `volume_name` varchar(128) DEFAULT '第一卷',
  `chapter_number` int DEFAULT '0',
  `book_info_set` tinyint DEFAULT '0',
  `status` enum('queued','running','stopped','deleted') DEFAULT 'queued',
  `entry_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_executed_at` datetime DEFAULT NULL,
  `recoverable_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `error_message` text,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`task_id`),
  KEY `idx_status` (`status`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_dispatch` (`status`,`recoverable_at`,`entry_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
