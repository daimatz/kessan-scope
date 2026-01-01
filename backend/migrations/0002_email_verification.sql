-- Email verification columns
ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN email_verification_token TEXT;
ALTER TABLE users ADD COLUMN email_verification_expires_at DATETIME;

-- Index for token lookup
CREATE INDEX IF NOT EXISTS idx_users_email_verification_token ON users(email_verification_token);
