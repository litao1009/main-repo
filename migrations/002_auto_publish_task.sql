USE claw_studios;

CREATE TABLE IF NOT EXISTS auto_publish_task (
    task_id           VARCHAR(64)   PRIMARY KEY,
    user_id           VARCHAR(64)   NOT NULL,
    platform          VARCHAR(32)   NOT NULL DEFAULT 'fanqie',
    work_id           VARCHAR(64)   DEFAULT '',
    skill_id          VARCHAR(64)   NOT NULL,
    topic             VARCHAR(512)  DEFAULT '',
    novel_name        VARCHAR(256)  DEFAULT '',
    volume_name       VARCHAR(128)  DEFAULT '第一卷',
    chapter_number    INT           DEFAULT 0,
    book_info_set     TINYINT       DEFAULT 0,
    status            ENUM('queued','running','stopped','deleted')
                      DEFAULT 'queued',
    entry_time        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_executed_at  DATETIME      DEFAULT NULL,
    recoverable_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    error_message     TEXT          DEFAULT NULL,
    created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
                      ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_status          (status),
    INDEX idx_user_id         (user_id),
    INDEX idx_dispatch        (status, recoverable_at, entry_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
