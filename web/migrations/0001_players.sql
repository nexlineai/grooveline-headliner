-- grooveline-headliner Worker's own database (headliner-db): the web game's players and what they own.
-- Separate from the radio's grooveline-db (DJs): a player is never a DJ.
CREATE TABLE players (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,          -- lower case
  created_at INTEGER NOT NULL,
  last_login INTEGER
);

-- A sign-in link: only the hash of the token is stored; one use, 15 minutes.
CREATE TABLE login_links (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  next       TEXT NOT NULL DEFAULT '',      -- '' (the game) or 'unlock' (the checkout page)
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE INDEX login_links_expires ON login_links (expires_at);

-- What a player owns. source: 'paddle' (a payment, ref = txn_...) or 'grant' (given by hand).
CREATE TABLE entitlements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id  TEXT NOT NULL REFERENCES players (id),
  product    TEXT NOT NULL,                 -- 'career'
  source     TEXT NOT NULL,
  ref        TEXT UNIQUE,                   -- one row per payment: a replayed webhook changes nothing
  created_at INTEGER NOT NULL,
  revoked_at INTEGER                        -- a refund or a chargeback
);
CREATE INDEX entitlements_player ON entitlements (player_id, product);

-- Every Paddle notification, as received (to find a payment that matched no player).
CREATE TABLE paddle_events (
  event_id    TEXT PRIMARY KEY,
  event_type  TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  body        TEXT NOT NULL,
  handled     TEXT
);

CREATE TABLE rate_limits (
  bucket       TEXT PRIMARY KEY,
  count        INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
