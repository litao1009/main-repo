USE claw_studios;

ALTER TABLE auto_publish_task
    ADD COLUMN account_ids VARCHAR(1024) DEFAULT '' AFTER user_id;
