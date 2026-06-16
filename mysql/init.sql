-- Quad-OS 调度模拟平台 · 数据库初始化
-- 数据库由 docker-compose 的 MYSQL_DATABASE 创建，这里建表（后端启动时 SQLAlchemy 亦会自动建表，二者一致）。

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS scenarios (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    module      VARCHAR(32)  NOT NULL,
    name        VARCHAR(128) NOT NULL,
    description VARCHAR(255) DEFAULT '',
    input_json  TEXT         NOT NULL,
    is_preset   TINYINT(1)   DEFAULT 0,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_scenarios_module (module)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS run_history (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    module       VARCHAR(32) NOT NULL,
    algorithm    VARCHAR(64) NOT NULL,
    input_json   TEXT        NOT NULL,
    metrics_json TEXT        NOT NULL,
    created_at   DATETIME    DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_history_module (module)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
