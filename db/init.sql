CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE posts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  content TEXT,
  media_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  sender_id INTEGER REFERENCES users(id),
  receiver_id INTEGER REFERENCES users(id),
  text TEXT,
  media_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE frames (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  image_url VARCHAR(500) NOT NULL,
  caption TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE user_frames (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  frame_id INTEGER REFERENCES frames(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, frame_id)
);

-- Варианты для голосования (привязаны к рамке)
CREATE TABLE frame_options (
  id SERIAL PRIMARY KEY,
  frame_id INTEGER REFERENCES frames(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  votes INTEGER DEFAULT 0
);

-- Кто за что голосовал
CREATE TABLE votes (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  option_id INTEGER REFERENCES frame_options(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, option_id)
);

-- Настройки (таймер окончания голосования)
CREATE TABLE settings (
  key VARCHAR(50) PRIMARY KEY,
  value TEXT
);
INSERT INTO settings (key, value) VALUES ('voting_ends_at', '2026-12-31T23:59:59');

-- Стартовый админ
INSERT INTO users (username, password, is_admin) VALUES ('admin', 'admin', TRUE);