-- pytest 전용 DB (실제 데이터가 있는 tetris DB와 분리)
CREATE DATABASE IF NOT EXISTS tetris_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
GRANT ALL PRIVILEGES ON tetris_test.* TO 'tetris'@'%';
