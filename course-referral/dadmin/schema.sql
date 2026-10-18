-- Run once in DirectAdmin > MySQL Management > phpMyAdmin (after creating the database).
-- The whole app record is stored as one JSON document, the same way the Redis version did it.
CREATE TABLE IF NOT EXISTS app_data (
  id INT NOT NULL PRIMARY KEY,
  data LONGTEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
