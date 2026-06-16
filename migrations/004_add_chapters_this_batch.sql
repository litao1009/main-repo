USE claw_studios;

ALTER TABLE auto_publish_task ADD COLUMN chapters_this_batch INT DEFAULT 0 AFTER chapter_number;
