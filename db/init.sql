CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE posts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  content TEXT,
  media_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  receiver_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  text TEXT,
  media_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE frames (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  image_url VARCHAR(500),          -- рисунок админа (показывается пока идёт голосование)
  caption TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE user_frames (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  frame_id INTEGER REFERENCES frames(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, frame_id)
);

CREATE TABLE frame_options (
  id SERIAL PRIMARY KEY,
  frame_id INTEGER REFERENCES frames(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  image_url VARCHAR(500),          -- фото участника
  votes INTEGER DEFAULT 0
);

-- Один голос на пользователя на одну рамку
CREATE TABLE votes (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  frame_id INTEGER REFERENCES frames(id) ON DELETE CASCADE,
  option_id INTEGER REFERENCES frame_options(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, frame_id)
);

CREATE TABLE settings (
  key VARCHAR(50) PRIMARY KEY,
  value TEXT
);

INSERT INTO settings (key, value) VALUES ('voting_ends_at', '2026-12-31T23:59:59');

-- Админ: admin / admin
-- bcrypt hash of "admin" (cost 10)
INSERT INTO users (username, password_hash, is_admin)
VALUES (
  'admin',
  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
  TRUE
);