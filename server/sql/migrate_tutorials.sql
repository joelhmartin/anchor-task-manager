-- Tutorial completion tracking per user (idempotent)
CREATE TABLE IF NOT EXISTS user_tutorial_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tutorial_id TEXT NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, tutorial_id)
);
