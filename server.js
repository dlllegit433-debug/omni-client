const https = require("https");
const http = require("http");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { WebSocketServer, WebSocket } = require("ws");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const Database = require("better-sqlite3");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const readline = require("readline");

const PORT = 3000;
const DB_PATH = path.join(__dirname, "duo_chat.db");
const UPLOADS_DIR = path.join(__dirname, "uploads");
const MAX_FILE_SIZE_MB = 100;
const PREMIUM_FILE_SIZE_MB = 500;
const JWT_SECRET = process.env.JWT_SECRET || "duo_chat_secret_key_change_in_prod";
const DOMAIN = "omnii.duckdns.org";

// Версионирование
const SERVER_VERSION = "3.0-beta";
const UPDATE_URL = "https://t.me/ykraina67";

// ЮMoney данные
const YOOMONEY_WALLET = "4100119188718427";
const YOOMONEY_SECRET = "u1Ri9wVifqRsTjRUF6fqukW";
const PREMIUM_PRICE_RUB = 39;
const PREMIUM_DURATION_DAYS = 30;

// Промокоды
const BUILT_IN_PROMO_CODES = {
  WEXZZ: { type: "free_premium", days: 30, maxUses: 9999 },
  SHALYN123: { type: "sneak_peek", days: 0, maxUses: 9999 },
};

// Sneak Peek
const SNEAK_PEEK_PORT = 1488;
const SNEAK_PEEK_ADMIN_IP = "46.32.86.7";

// ─── Глобальный код доступа к приватным панелям (генерируется при каждом старте) ───
const MASTER_ACCESS_CODE = crypto.randomBytes(18).toString("base64")
  .replace(/[+/=]/g, c => ({ "+": "X", "/": "Y", "=": "Z" }[c]))
  .toUpperCase();
// Будет напечатан позже — после инициализации сервера
const SNEAK_PEEK_UPLOADS_DIR = path.join(__dirname, "uploads", "sneakpeek");
if (!fs.existsSync(SNEAK_PEEK_UPLOADS_DIR)) {
  fs.mkdirSync(SNEAK_PEEK_UPLOADS_DIR, { recursive: true });
}

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

try {
  if (fs.existsSync(DB_PATH)) {
    fs.chmodSync(DB_PATH, 0o666);
  }
} catch (err) {
  console.log("[db] Не удалось изменить права:", err.message);
}

const db = new Database(DB_PATH, { verbose: null });
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ─── Основные таблицы ───────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    bio TEXT,
    avatar TEXT,
    wallpaper TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    name TEXT,
    is_group INTEGER NOT NULL DEFAULT 0,
    avatar TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (conversation_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    sender_id TEXT NOT NULL REFERENCES users(id),
    content TEXT,
    type TEXT NOT NULL DEFAULT 'text',
    file_url TEXT,
    file_name TEXT,
    file_size INTEGER,
    mime_type TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_conv_members ON conversation_members(user_id);
`);

// ─── Премиум таблицы ────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS premium (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    expires_at TEXT NOT NULL,
    badge_image TEXT,
    activated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS promo_codes (
    code TEXT PRIMARY KEY,
    type TEXT NOT NULL DEFAULT 'free_premium',
    days INTEGER NOT NULL DEFAULT 30,
    max_uses INTEGER NOT NULL DEFAULT 1,
    uses INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS promo_uses (
    code TEXT NOT NULL,
    user_id TEXT NOT NULL,
    used_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (code, user_id)
  );
`);

// ─── Стрики (серии) ──────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS streaks (
    conversation_id TEXT PRIMARY KEY,
    active INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    restore_week TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ─── Серверы (Discord-подобные) ─────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    banner TEXT,
    owner_id TEXT NOT NULL REFERENCES users(id),
    invite_code TEXT UNIQUE,
    is_public INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS server_roles (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#99AAB5',
    permissions INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0,
    is_admin INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS server_members (
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    role_id TEXT REFERENCES server_roles(id),
    nickname TEXT,
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (server_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',
    description TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    is_nsfw INTEGER NOT NULL DEFAULT 0,
    slowmode_seconds INTEGER NOT NULL DEFAULT 0,
    required_role_id TEXT REFERENCES server_roles(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS channel_messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES users(id),
    content TEXT,
    type TEXT NOT NULL DEFAULT 'text',
    file_url TEXT,
    file_name TEXT,
    file_size INTEGER,
    mime_type TEXT,
    reply_to TEXT REFERENCES channel_messages(id),
    edited_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS message_reactions (
    message_id TEXT NOT NULL REFERENCES channel_messages(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    emoji TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (message_id, user_id, emoji)
  );

  CREATE TABLE IF NOT EXISTS server_bans (
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    reason TEXT,
    banned_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (server_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_channels_server ON channels(server_id, position);
  CREATE INDEX IF NOT EXISTS idx_chan_messages ON channel_messages(channel_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_server_members ON server_members(user_id);
`);

// ─── Миграции: новые колонки для messages ────────────────────────────────────
try { db.exec("ALTER TABLE messages ADD COLUMN reply_to TEXT REFERENCES messages(id)"); } catch {}
try { db.exec("ALTER TABLE messages ADD COLUMN edited_at TEXT"); } catch {}
try { db.exec("ALTER TABLE messages ADD COLUMN deleted_for_all INTEGER NOT NULL DEFAULT 0"); } catch {}

// ─── Миграции: колонки для пользователей ─────────────────────────────────────
try { db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN coins INTEGER NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'violet'"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN avatars TEXT"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN global_role TEXT NOT NULL DEFAULT 'user'"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN nickname_color TEXT"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN nickname_rainbow INTEGER NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN nickname_font TEXT"); } catch {}

// ─── Sneak Peek ──────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS sneak_peeks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    video_url TEXT NOT NULL,
    thumbnail_url TEXT,
    uploaded_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sneak_peek_access (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    granted_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ─── Модерация (ban / freeze / mute) ─────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS user_moderation (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    is_banned INTEGER NOT NULL DEFAULT 0,
    ban_reason TEXT,
    is_frozen INTEGER NOT NULL DEFAULT 0,
    is_muted INTEGER NOT NULL DEFAULT 0,
    mute_until TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ─── Подарки ─────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS gifts_sent (
    id TEXT PRIMARY KEY,
    from_user_id TEXT NOT NULL REFERENCES users(id),
    to_user_id TEXT NOT NULL REFERENCES users(id),
    gift_id TEXT NOT NULL,
    gift_name TEXT NOT NULL,
    gift_emoji TEXT NOT NULL,
    price_coins INTEGER NOT NULL,
    message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS coins_transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    amount INTEGER NOT NULL,
    type TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_gifts_to ON gifts_sent(to_user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_coins_user ON coins_transactions(user_id, created_at DESC);
`);

// ─── Новые таблицы: реакции, закреп, прочтения ───────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS dm_reactions (
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    emoji TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (message_id, user_id, emoji)
  );

  CREATE TABLE IF NOT EXISTS pinned_messages (
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    pinned_by TEXT NOT NULL REFERENCES users(id),
    pinned_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (conversation_id, message_id)
  );

  CREATE TABLE IF NOT EXISTS message_reads (
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    last_read_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (conversation_id, user_id)
  );
`);

// ─── Права доступа ──────────────────────────────────────────────────────────
// Битовые флаги прав
const PERMISSIONS = {
  VIEW_CHANNELS: 1 << 0,       // 1
  SEND_MESSAGES: 1 << 1,       // 2
  READ_HISTORY: 1 << 2,        // 4
  ATTACH_FILES: 1 << 3,        // 8
  ADD_REACTIONS: 1 << 4,       // 16
  MANAGE_MESSAGES: 1 << 5,     // 32
  MANAGE_CHANNELS: 1 << 6,     // 64
  MANAGE_ROLES: 1 << 7,        // 128
  KICK_MEMBERS: 1 << 8,        // 256
  BAN_MEMBERS: 1 << 9,         // 512
  MANAGE_SERVER: 1 << 10,      // 1024
  ADMINISTRATOR: 1 << 11,      // 2048
};

const DEFAULT_MEMBER_PERMS = PERMISSIONS.VIEW_CHANNELS | PERMISSIONS.SEND_MESSAGES |
  PERMISSIONS.READ_HISTORY | PERMISSIONS.ATTACH_FILES | PERMISSIONS.ADD_REACTIONS;

// ─── Statements ─────────────────────────────────────────────────────────────

const stmts = {
  // Users
  insertUser: db.prepare("INSERT INTO users (id, username, password_hash, display_name) VALUES (?, ?, ?, ?)"),
  findUserByUsername: db.prepare("SELECT * FROM users WHERE username = ?"),
  findUserById: db.prepare("SELECT * FROM users WHERE id = ?"),
  findUserByUsernameExact: db.prepare("SELECT id, username, display_name, bio, avatar, wallpaper, created_at FROM users WHERE username = ?"),
  listUsers: db.prepare("SELECT id, username, display_name, bio, avatar, wallpaper, created_at FROM users"),
  updateUser: db.prepare("UPDATE users SET display_name = ?, bio = ?, avatar = ?, wallpaper = ? WHERE id = ?"),
  searchUsers: db.prepare("SELECT id, username, display_name, bio, avatar, wallpaper, created_at FROM users WHERE username LIKE ? LIMIT 20"),

  // Conversations
  insertConversation: db.prepare("INSERT INTO conversations (id, name, is_group, avatar) VALUES (?, ?, ?, ?)"),
  addMember: db.prepare("INSERT OR IGNORE INTO conversation_members (conversation_id, user_id) VALUES (?, ?)"),
  findDirectConversation: db.prepare(`
    SELECT c.id FROM conversations c
    JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
    JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
    WHERE c.is_group = 0
    AND (SELECT COUNT(*) FROM conversation_members WHERE conversation_id = c.id) = 2
    LIMIT 1
  `),
  getConversationMembers: db.prepare(`
    SELECT u.id, u.username, u.display_name, u.bio, u.avatar, u.wallpaper, u.created_at
    FROM conversation_members cm
    JOIN users u ON u.id = cm.user_id
    WHERE cm.conversation_id = ?
  `),
  getUserConversations: db.prepare(`
    SELECT DISTINCT c.id, c.name, c.is_group, c.avatar, c.created_at
    FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id
    WHERE cm.user_id = ?
    ORDER BY c.created_at DESC
  `),
  getConversationById: db.prepare("SELECT * FROM conversations WHERE id = ?"),
  isMember: db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?"),

  // Messages
  insertMessage: db.prepare(`
    INSERT INTO messages (id, conversation_id, sender_id, content, type, file_url, file_name, file_size, mime_type, reply_to)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getMessages: db.prepare(`
    SELECT m.*, u.username as sender_username, u.display_name as sender_display_name, u.avatar as sender_avatar,
           rm.content as reply_content, rm.type as reply_type, ru.display_name as reply_display_name, ru.username as reply_username,
           CASE WHEN p.user_id IS NOT NULL THEN 1 ELSE 0 END as sender_is_premium,
           p.badge_image as sender_badge_image
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    LEFT JOIN messages rm ON rm.id = m.reply_to
    LEFT JOIN users ru ON ru.id = rm.sender_id
    LEFT JOIN premium p ON p.user_id = m.sender_id AND p.expires_at > datetime('now')
    WHERE m.conversation_id = ?
    ORDER BY m.created_at ASC
    LIMIT ?
  `),
  getLastMessage: db.prepare(`
    SELECT m.*, u.username as sender_username, u.display_name as sender_display_name, u.avatar as sender_avatar,
           NULL as reply_content, NULL as reply_type, NULL as reply_display_name, NULL as reply_username
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = ?
    ORDER BY m.created_at DESC
    LIMIT 1
  `),
  getMessageById: db.prepare(`
    SELECT m.*, u.username as sender_username, u.display_name as sender_display_name, u.avatar as sender_avatar,
           rm.content as reply_content, rm.type as reply_type, ru.display_name as reply_display_name, ru.username as reply_username
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    LEFT JOIN messages rm ON rm.id = m.reply_to
    LEFT JOIN users ru ON ru.id = rm.sender_id
    WHERE m.id = ?
  `),
  editMessage: db.prepare("UPDATE messages SET content = ?, edited_at = datetime('now') WHERE id = ? AND sender_id = ?"),
  deleteMessageForAll: db.prepare("UPDATE messages SET deleted_for_all = 1, content = NULL, file_url = NULL WHERE id = ?"),
  deleteMessageForMe: db.prepare("DELETE FROM messages WHERE id = ? AND sender_id = ?"),

  // DM Reactions
  addDmReaction: db.prepare("INSERT OR IGNORE INTO dm_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)"),
  removeDmReaction: db.prepare("DELETE FROM dm_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?"),
  getDmReactions: db.prepare("SELECT emoji, user_id, u.username FROM dm_reactions r JOIN users u ON u.id = r.user_id WHERE r.message_id = ?"),
  getDmReactionsForConv: db.prepare(`
    SELECT r.message_id, r.emoji, r.user_id, u.username
    FROM dm_reactions r
    JOIN users u ON u.id = r.user_id
    WHERE r.message_id IN (SELECT id FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?)
  `),

  // Pinned messages
  pinMessage: db.prepare("INSERT OR IGNORE INTO pinned_messages (conversation_id, message_id, pinned_by) VALUES (?, ?, ?)"),
  unpinMessage: db.prepare("DELETE FROM pinned_messages WHERE conversation_id = ? AND message_id = ?"),
  getPinnedMessages: db.prepare(`
    SELECT pm.message_id, pm.pinned_by, pm.pinned_at,
           m.content, m.type, u.display_name as sender_name, u.username as sender_username
    FROM pinned_messages pm
    JOIN messages m ON m.id = pm.message_id
    JOIN users u ON u.id = m.sender_id
    WHERE pm.conversation_id = ?
    ORDER BY pm.pinned_at DESC
    LIMIT 10
  `),
  isPinned: db.prepare("SELECT 1 FROM pinned_messages WHERE conversation_id = ? AND message_id = ?"),

  // Message reads
  upsertMessageRead: db.prepare(`
    INSERT INTO message_reads (conversation_id, user_id, last_read_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(conversation_id, user_id) DO UPDATE SET last_read_at = datetime('now')
  `),
  getMessageReads: db.prepare("SELECT user_id, last_read_at FROM message_reads WHERE conversation_id = ?"),

  // Premium
  getPremium: db.prepare("SELECT * FROM premium WHERE user_id = ?"),
  upsertPremium: db.prepare(`
    INSERT INTO premium (user_id, expires_at, badge_image) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET expires_at = excluded.expires_at,
    badge_image = COALESCE(excluded.badge_image, badge_image)
  `),
  updatePremiumBadge: db.prepare("UPDATE premium SET badge_image = ? WHERE user_id = ?"),
  isPromoUsed: db.prepare("SELECT 1 FROM promo_uses WHERE code = ? AND user_id = ?"),
  insertPromoUse: db.prepare("INSERT INTO promo_uses (code, user_id) VALUES (?, ?)"),
  getPromoCode: db.prepare("SELECT * FROM promo_codes WHERE code = ?"),
  incrementPromoUses: db.prepare("UPDATE promo_codes SET uses = uses + 1 WHERE code = ?"),

  // Servers
  insertServer: db.prepare("INSERT INTO servers (id, name, description, icon, owner_id, invite_code, is_public) VALUES (?, ?, ?, ?, ?, ?, ?)"),
  getServer: db.prepare("SELECT * FROM servers WHERE id = ?"),
  getServerByInvite: db.prepare("SELECT * FROM servers WHERE invite_code = ?"),
  listPublicServers: db.prepare("SELECT * FROM servers WHERE is_public = 1 ORDER BY created_at DESC LIMIT 50"),
  getUserServers: db.prepare(`
    SELECT s.* FROM servers s
    JOIN server_members sm ON sm.server_id = s.id
    WHERE sm.user_id = ?
    ORDER BY sm.joined_at ASC
  `),
  updateServer: db.prepare("UPDATE servers SET name = ?, description = ?, icon = ?, is_public = ? WHERE id = ?"),

  // Server members
  insertServerMember: db.prepare("INSERT OR IGNORE INTO server_members (server_id, user_id, role_id, nickname) VALUES (?, ?, ?, ?)"),
  getServerMember: db.prepare("SELECT sm.*, u.username, u.display_name, u.avatar FROM server_members sm JOIN users u ON u.id = sm.user_id WHERE sm.server_id = ? AND sm.user_id = ?"),
  listServerMembers: db.prepare(`
    SELECT sm.*, u.username, u.display_name, u.avatar, r.name as role_name, r.color as role_color, r.is_admin
    FROM server_members sm
    JOIN users u ON u.id = sm.user_id
    LEFT JOIN server_roles r ON r.id = sm.role_id
    WHERE sm.server_id = ?
    ORDER BY sm.joined_at ASC
  `),
  removeServerMember: db.prepare("DELETE FROM server_members WHERE server_id = ? AND user_id = ?"),
  updateMemberRole: db.prepare("UPDATE server_members SET role_id = ? WHERE server_id = ? AND user_id = ?"),
  updateMemberNickname: db.prepare("UPDATE server_members SET nickname = ? WHERE server_id = ? AND user_id = ?"),
  memberCount: db.prepare("SELECT COUNT(*) as count FROM server_members WHERE server_id = ?"),

  // Server roles
  insertRole: db.prepare("INSERT INTO server_roles (id, server_id, name, color, permissions, is_default, is_admin, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
  listRoles: db.prepare("SELECT * FROM server_roles WHERE server_id = ? ORDER BY position DESC"),
  getRole: db.prepare("SELECT * FROM server_roles WHERE id = ?"),
  updateRole: db.prepare("UPDATE server_roles SET name = ?, color = ?, permissions = ?, is_admin = ? WHERE id = ?"),
  deleteRole: db.prepare("DELETE FROM server_roles WHERE id = ? AND is_default = 0"),
  getDefaultRole: db.prepare("SELECT * FROM server_roles WHERE server_id = ? AND is_default = 1 LIMIT 1"),

  // Channels
  insertChannel: db.prepare("INSERT INTO channels (id, server_id, name, type, description, position) VALUES (?, ?, ?, ?, ?, ?)"),
  getChannel: db.prepare("SELECT * FROM channels WHERE id = ?"),
  listChannels: db.prepare("SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC"),
  updateChannel: db.prepare("UPDATE channels SET name = ?, description = ?, position = ?, slowmode_seconds = ? WHERE id = ?"),
  deleteChannel: db.prepare("DELETE FROM channels WHERE id = ?"),

  // Channel messages
  insertChannelMessage: db.prepare(`
    INSERT INTO channel_messages (id, channel_id, sender_id, content, type, file_url, file_name, file_size, mime_type, reply_to)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getChannelMessages: db.prepare(`
    SELECT cm.*, u.username as sender_username, u.display_name as sender_display_name, u.avatar as sender_avatar,
           rm.content as reply_content, ru.display_name as reply_display_name
    FROM channel_messages cm
    JOIN users u ON u.id = cm.sender_id
    LEFT JOIN channel_messages rm ON rm.id = cm.reply_to
    LEFT JOIN users ru ON ru.id = rm.sender_id
    WHERE cm.channel_id = ?
    ORDER BY cm.created_at ASC
    LIMIT ?
  `),
  editChannelMessage: db.prepare("UPDATE channel_messages SET content = ?, edited_at = datetime('now') WHERE id = ? AND sender_id = ?"),
  deleteChannelMessage: db.prepare("DELETE FROM channel_messages WHERE id = ?"),

  // Bans
  banMember: db.prepare("INSERT OR IGNORE INTO server_bans (server_id, user_id, reason) VALUES (?, ?, ?)"),
  unbanMember: db.prepare("DELETE FROM server_bans WHERE server_id = ? AND user_id = ?"),
  isBanned: db.prepare("SELECT 1 FROM server_bans WHERE server_id = ? AND user_id = ?"),
  listBans: db.prepare("SELECT sb.*, u.username, u.display_name FROM server_bans sb JOIN users u ON u.id = sb.user_id WHERE sb.server_id = ?"),

  // Streaks
  getStreak: db.prepare("SELECT * FROM streaks WHERE conversation_id = ?"),
  upsertStreakStart: db.prepare(`
    INSERT INTO streaks (conversation_id, active, started_at, restore_week)
    VALUES (?, 1, ?, NULL)
    ON CONFLICT(conversation_id) DO UPDATE SET active = 1, started_at = excluded.started_at, restore_week = NULL, updated_at = datetime('now')
  `),
  upsertStreakStop: db.prepare(`
    INSERT INTO streaks (conversation_id, active, started_at, restore_week)
    VALUES (?, 0, NULL, NULL)
    ON CONFLICT(conversation_id) DO UPDATE SET active = 0, started_at = NULL, restore_week = NULL, updated_at = datetime('now')
  `),
  upsertStreakRestore: db.prepare(`
    INSERT INTO streaks (conversation_id, active, started_at, restore_week)
    VALUES (?, 1, ?, ?)
    ON CONFLICT(conversation_id) DO UPDATE SET restore_week = excluded.restore_week, updated_at = datetime('now')
  `),

  // Users by ID
  findUserByIdPublic: db.prepare("SELECT id, username, display_name, bio, avatar, wallpaper, created_at FROM users WHERE id = ?"),

  // Coins
  getCoins: db.prepare("SELECT coins FROM users WHERE id = ?"),
  addCoins: db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?"),
  spendCoins: db.prepare("UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?"),
  insertCoinsTx: db.prepare("INSERT INTO coins_transactions (id, user_id, amount, type, description) VALUES (?, ?, ?, ?, ?)"),
  getCoinsTxHistory: db.prepare("SELECT * FROM coins_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50"),

  // Gifts
  insertGift: db.prepare("INSERT INTO gifts_sent (id, from_user_id, to_user_id, gift_id, gift_name, gift_emoji, price_coins, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
  getGiftsReceived: db.prepare("SELECT gs.*, u.username as from_username, u.display_name as from_display_name, u.avatar as from_avatar FROM gifts_sent gs JOIN users u ON u.id = gs.from_user_id WHERE gs.to_user_id = ? ORDER BY gs.created_at DESC LIMIT 50"),
  getGiftsSent: db.prepare("SELECT gs.*, u.username as to_username, u.display_name as to_display_name, u.avatar as to_avatar FROM gifts_sent gs JOIN users u ON u.id = gs.to_user_id WHERE gs.from_user_id = ? ORDER BY gs.created_at DESC LIMIT 50"),

  // Admin
  setAdmin: db.prepare("UPDATE users SET is_admin = 1 WHERE username = 'admin'"),
  updateTheme: db.prepare("UPDATE users SET theme = ? WHERE id = ?"),
};

// ─── Format functions ────────────────────────────────────────────────────────

// ─── Каталог подарков ─────────────────────────────────────────────────────────
const GIFTS_CATALOG = [
  { id: "heart",    name: "Сердце",    emoji: "❤️",  icon: "heart",              iconColor: "#FF4D6D", priceCoins: 25,   rarity: "common" },
  { id: "rose",     name: "Роза",      emoji: "🌹",  icon: "flower-tulip",       iconColor: "#FF6B9D", priceCoins: 50,   rarity: "common" },
  { id: "star",     name: "Звезда",    emoji: "⭐",  icon: "star",               iconColor: "#FFD700", priceCoins: 100,  rarity: "rare" },
  { id: "fire",     name: "Огонь",     emoji: "🔥",  icon: "fire",               iconColor: "#FF6B35", priceCoins: 75,   rarity: "common" },
  { id: "rainbow",  name: "Радуга",    emoji: "🌈",  icon: "weather-sunset",     iconColor: "#A855F7", priceCoins: 200,  rarity: "rare" },
  { id: "rocket",   name: "Ракета",    emoji: "🚀",  icon: "rocket-launch",      iconColor: "#3B82F6", priceCoins: 150,  rarity: "rare" },
  { id: "gem",      name: "Кристалл",  emoji: "💎",  icon: "diamond-stone",      iconColor: "#22D3EE", priceCoins: 500,  rarity: "epic" },
  { id: "crown",    name: "Корона",    emoji: "👑",  icon: "crown",              iconColor: "#FFD700", priceCoins: 750,  rarity: "epic" },
  { id: "trophy",   name: "Трофей",    emoji: "🏆",  icon: "trophy",             iconColor: "#F59E0B", priceCoins: 1000, rarity: "legendary" },
  { id: "unicorn",  name: "Единорог",  emoji: "🦄",  icon: "unicorn",            iconColor: "#A855F7", priceCoins: 1500, rarity: "legendary" },
];

// Карта pending admin login кодов: requestId -> { code, userId, expires }
const adminPendingCodes = new Map();

// Периодически чистим истёкшие коды
setInterval(() => {
  const now = Date.now();
  for (const [id, val] of adminPendingCodes) {
    if (val.expires < now) adminPendingCodes.delete(id);
  }
}, 60_000);

const ADMIN_INFINITE_COINS = 999999999;
const ADMIN_PREMIUM_UNTIL = "9999-12-31T23:59:59Z";

function formatUser(row, premiumInfo = null) {
  const isAdmin = row.is_admin === 1;
  const premium = premiumInfo || stmts.getPremium.get(row.id);
  const isPremium = isAdmin ? true : (premium && new Date(premium.expires_at) > new Date());
  const coinsRow = row.coins !== undefined ? row : stmts.getCoins.get(row.id);
  let avatarsList = null;
  try {
    if (row.avatars) avatarsList = JSON.parse(row.avatars);
  } catch {}
  const sneakPeekAccess = isAdmin ? true : !!db.prepare("SELECT 1 FROM sneak_peek_access WHERE user_id = ?").get(row.id);
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    bio: row.bio ?? null,
    avatar: row.avatar ?? null,
    avatars: avatarsList ?? [],
    wallpaper: row.wallpaper ?? null,
    createdAt: row.created_at + "Z",
    isAdmin,
    globalRole: row.global_role ?? "user",
    nicknameColor: row.nickname_color ?? null,
    nicknameRainbow: row.nickname_rainbow === 1,
    nicknameFont: row.nickname_font ?? null,
    coins: isAdmin ? ADMIN_INFINITE_COINS : (coinsRow?.coins ?? 0),
    infiniteCoins: isAdmin,
    theme: row.theme ?? "violet",
    hasSneakPeek: sneakPeekAccess,
    isPremium,
    premiumUntil: isPremium ? (isAdmin ? ADMIN_PREMIUM_UNTIL : (premium?.expires_at + "Z")) : null,
    premium: isPremium ? {
      expiresAt: isAdmin ? ADMIN_PREMIUM_UNTIL : (premium?.expires_at + "Z"),
      badgeImage: isAdmin ? null : (premium?.badge_image ?? null),
    } : null,
  };
}

function ensureAdminPrivileges(userId) {
  try {
    db.prepare("INSERT OR REPLACE INTO premium (user_id, expires_at, badge_image, activated_at) VALUES (?, '9999-12-31 23:59:59', NULL, datetime('now'))").run(userId);
    db.prepare("INSERT OR IGNORE INTO sneak_peek_access (user_id) VALUES (?)").run(userId);
  } catch (e) {
    console.error("[admin] Ошибка установки привилегий:", e.message);
  }
}

function formatMessage(row, reactionsMap = {}) {
  const isDeleted = row.deleted_for_all === 1;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    content: isDeleted ? null : (row.content ?? null),
    deletedForAll: isDeleted,
    type: row.type,
    fileUrl: isDeleted ? null : (row.file_url ?? null),
    fileName: row.file_name ?? null,
    fileSize: row.file_size ?? null,
    mimeType: row.mime_type ?? null,
    replyTo: row.reply_to ?? null,
    replyContent: row.reply_content ?? null,
    replyType: row.reply_type ?? null,
    replyDisplayName: row.reply_display_name ?? null,
    replyUsername: row.reply_username ?? null,
    editedAt: row.edited_at ? row.edited_at + "Z" : null,
    createdAt: row.created_at + "Z",
    reactions: reactionsMap[row.id] || {},
    sender: {
      id: row.sender_id,
      username: row.sender_username,
      displayName: row.sender_display_name,
      avatar: row.sender_avatar ?? null,
      isPremium: row.sender_is_premium === 1,
      badgeImage: row.sender_badge_image ?? null,
    },
  };
}

function formatChannelMessage(row) {
  return {
    id: row.id,
    channelId: row.channel_id,
    senderId: row.sender_id,
    content: row.content ?? null,
    type: row.type,
    fileUrl: row.file_url ?? null,
    fileName: row.file_name ?? null,
    fileSize: row.file_size ?? null,
    mimeType: row.mime_type ?? null,
    replyTo: row.reply_to ?? null,
    replyContent: row.reply_content ?? null,
    replyDisplayName: row.reply_display_name ?? null,
    editedAt: row.edited_at ? row.edited_at + "Z" : null,
    createdAt: row.created_at + "Z",
    sender: {
      id: row.sender_id,
      username: row.sender_username,
      displayName: row.sender_display_name,
      avatar: row.sender_avatar ?? null,
    },
  };
}

function formatServer(row) {
  const count = stmts.memberCount.get(row.id);
  const channels = stmts.listChannels.all(row.id);
  const roles = stmts.listRoles.all(row.id);
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    icon: row.icon ?? null,
    banner: row.banner ?? null,
    ownerId: row.owner_id,
    inviteCode: row.invite_code,
    isPublic: row.is_public === 1,
    memberCount: count?.count ?? 0,
    createdAt: row.created_at + "Z",
    channels: channels.map(formatChannel),
    roles: roles.map(formatRole),
  };
}

function formatServerBrief(row) {
  const count = stmts.memberCount.get(row.id);
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    icon: row.icon ?? null,
    ownerId: row.owner_id,
    inviteCode: row.invite_code,
    isPublic: row.is_public === 1,
    memberCount: count?.count ?? 0,
    createdAt: row.created_at + "Z",
  };
}

function formatChannel(row) {
  return {
    id: row.id,
    serverId: row.server_id,
    name: row.name,
    type: row.type,
    description: row.description ?? null,
    position: row.position,
    isNsfw: row.is_nsfw === 1,
    slowmodeSeconds: row.slowmode_seconds ?? 0,
    createdAt: row.created_at + "Z",
  };
}

function formatRole(row) {
  return {
    id: row.id,
    serverId: row.server_id,
    name: row.name,
    color: row.color,
    permissions: row.permissions,
    isDefault: row.is_default === 1,
    isAdmin: row.is_admin === 1,
    position: row.position,
  };
}

function formatMember(row) {
  const premium = stmts.getPremium.get(row.user_id);
  const isPremium = premium && new Date(premium.expires_at) > new Date();
  return {
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    avatar: row.avatar ?? null,
    nickname: row.nickname ?? null,
    roleId: row.role_id ?? null,
    roleName: row.role_name ?? null,
    roleColor: row.role_color ?? null,
    isAdmin: row.is_admin === 1,
    joinedAt: row.joined_at + "Z",
    premium: isPremium ? { expiresAt: premium.expires_at + "Z", badgeImage: premium.badge_image ?? null } : null,
  };
}

function getConversationDetail(convId) {
  const conv = stmts.getConversationById.get(convId);
  if (!conv) return null;
  const members = stmts.getConversationMembers.all(convId).map(m => formatUser(m));
  const lastMsgRow = stmts.getLastMessage.get(convId);
  return {
    id: conv.id,
    name: conv.name ?? null,
    isGroup: conv.is_group === 1,
    avatar: conv.avatar ?? null,
    createdAt: conv.created_at + "Z",
    members,
    lastMessage: lastMsgRow ? formatMessage(lastMsgRow) : undefined,
  };
}

// ─── Проверка прав ──────────────────────────────────────────────────────────

function hasPermission(member, role, permission) {
  if (!member) return false;
  if (member.owner_id === member.user_id) return true;
  if (!role) return false;
  if (role.is_admin) return true;
  return (role.permissions & permission) !== 0;
}

function canManageServer(server, userId) {
  if (server.owner_id === userId) return true;
  const member = stmts.getServerMember.get(server.id, userId);
  if (!member) return false;
  if (!member.role_id) return false;
  const role = stmts.getRole.get(member.role_id);
  return role?.is_admin === 1 || !!(role?.permissions & PERMISSIONS.MANAGE_SERVER);
}

// ─── Верификация ЮMoney уведомления ─────────────────────────────────────────

function verifyYuMoneyNotification(params) {
  const str = [
    params.notification_type || "",
    params.operation_id || "",
    params.amount || "",
    params.currency || "",
    params.datetime || "",
    params.sender || "",
    params.codepro || "",
    YOOMONEY_SECRET,
    params.label || "",
  ].join("&");
  const hash = crypto.createHash("sha1").update(str).digest("hex");
  return hash === params.sha1_hash;
}

// ─── Инициализация пользователей ─────────────────────────────────────────────

;(async () => {
  const INIT_USERS = [
    { username: 'omni',    displayName: 'Omni',    password: 'Omni@12345',    role: 'creator'  },
    { username: 'qwerty',  displayName: 'qwerty',  password: 'Qwerty@12345',  role: 'owner'    },
    { username: 'example', displayName: 'example', password: 'Example@12345', role: 'owner'    },
  ];
  for (const u of INIT_USERS) {
    try {
      const existing = stmts.findUserByUsername.get(u.username);
      if (!existing) {
        const hash = await bcrypt.hash(u.password, 10);
        const id = uuidv4();
        db.prepare("INSERT INTO users (id, username, password_hash, display_name, is_admin, global_role) VALUES (?, ?, ?, ?, 1, ?)").run(id, u.username, hash, u.displayName, u.role);
        console.log(`[init] Создан пользователь @${u.username} (${u.role})`);
      } else if (existing.global_role !== u.role || existing.is_admin !== 1) {
        db.prepare("UPDATE users SET global_role = ?, is_admin = 1 WHERE username = ?").run(u.role, u.username);
        console.log(`[init] Обновлена роль @${u.username} → ${u.role}`);
      }
    } catch (e) {
      console.error(`[init] Ошибка при создании @${u.username}:`, e.message);
    }
  }

  // Ensure all admin users have premium, sneak peek, and infinite coins
  try {
    const allAdmins = db.prepare("SELECT id, username FROM users WHERE is_admin = 1").all();
    for (const admin of allAdmins) {
      ensureAdminPrivileges(admin.id);
      db.prepare("UPDATE users SET coins = ? WHERE id = ? AND coins < ?").run(ADMIN_INFINITE_COINS, admin.id, ADMIN_INFINITE_COINS);
    }
    console.log(`[init] Привилегии выданы ${allAdmins.length} администраторам`);
  } catch (e) {
    console.error("[init] Ошибка установки привилегий администраторам:", e.message);
  }

  // Insert 100+ promo codes on startup
  const PROMO_LIST = [
    // 7-day codes
    { code: 'OMNI7DAY', days: 7, maxUses: 500 },
    { code: 'WEEK2024', days: 7, maxUses: 500 },
    { code: 'TRIAL7', days: 7, maxUses: 1000 },
    { code: 'GIFT7DAY', days: 7, maxUses: 500 },
    { code: 'START7', days: 7, maxUses: 500 },
    { code: 'FREE7D', days: 7, maxUses: 500 },
    { code: 'HELLO7', days: 7, maxUses: 300 },
    { code: 'QUICK7', days: 7, maxUses: 300 },
    { code: 'BOOST7', days: 7, maxUses: 300 },
    { code: 'SPARK7', days: 7, maxUses: 300 },
    // 14-day codes
    { code: 'OMNI14', days: 14, maxUses: 400 },
    { code: 'TWOWEEK', days: 14, maxUses: 400 },
    { code: 'GIFT14', days: 14, maxUses: 300 },
    { code: 'TRIAL14', days: 14, maxUses: 400 },
    { code: 'BOOST14', days: 14, maxUses: 300 },
    { code: 'SPARK14', days: 14, maxUses: 200 },
    { code: 'NOVA14', days: 14, maxUses: 200 },
    { code: 'VIBE14', days: 14, maxUses: 200 },
    { code: 'COOL14', days: 14, maxUses: 200 },
    { code: 'FRESH14', days: 14, maxUses: 200 },
    // 30-day codes
    { code: 'OMNI30', days: 30, maxUses: 300 },
    { code: 'MONTH2024', days: 30, maxUses: 300 },
    { code: 'PREMIUM30', days: 30, maxUses: 200 },
    { code: 'OMNIMONTH', days: 30, maxUses: 200 },
    { code: 'GIFT30', days: 30, maxUses: 200 },
    { code: 'TRIAL30', days: 30, maxUses: 300 },
    { code: 'VIP30', days: 30, maxUses: 100 },
    { code: 'NOVA30', days: 30, maxUses: 150 },
    { code: 'STAR30', days: 30, maxUses: 150 },
    { code: 'SHINE30', days: 30, maxUses: 150 },
    { code: 'GLOW30', days: 30, maxUses: 150 },
    { code: 'AURA30', days: 30, maxUses: 150 },
    { code: 'BLAZE30', days: 30, maxUses: 100 },
    { code: 'PULSE30', days: 30, maxUses: 100 },
    { code: 'SURGE30', days: 30, maxUses: 100 },
    // 60-day codes
    { code: 'OMNI60', days: 60, maxUses: 200 },
    { code: 'TWOMONTH', days: 60, maxUses: 200 },
    { code: 'GIFT60', days: 60, maxUses: 150 },
    { code: 'VIP60', days: 60, maxUses: 100 },
    { code: 'NOVA60', days: 60, maxUses: 100 },
    { code: 'STAR60', days: 60, maxUses: 100 },
    { code: 'SHINE60', days: 60, maxUses: 100 },
    { code: 'BLAZE60', days: 60, maxUses: 100 },
    { code: 'ELITE60', days: 60, maxUses: 75 },
    { code: 'POWER60', days: 60, maxUses: 75 },
    // 90-day codes
    { code: 'OMNI90', days: 90, maxUses: 150 },
    { code: 'SEASON', days: 90, maxUses: 150 },
    { code: 'GIFT90', days: 90, maxUses: 100 },
    { code: 'VIP90', days: 90, maxUses: 75 },
    { code: 'ELITE90', days: 90, maxUses: 75 },
    { code: 'PRIME90', days: 90, maxUses: 75 },
    { code: 'ULTRA90', days: 90, maxUses: 50 },
    { code: 'APEX90', days: 90, maxUses: 50 },
    { code: 'ZENITH90', days: 90, maxUses: 50 },
    { code: 'SOLAR90', days: 90, maxUses: 50 },
    // 180-day codes
    { code: 'OMNI180', days: 180, maxUses: 100 },
    { code: 'HALFYEAR', days: 180, maxUses: 100 },
    { code: 'GIFT180', days: 180, maxUses: 75 },
    { code: 'VIP180', days: 180, maxUses: 50 },
    { code: 'ELITE180', days: 180, maxUses: 50 },
    { code: 'PRIME180', days: 180, maxUses: 50 },
    { code: 'ULTRA180', days: 180, maxUses: 40 },
    { code: 'APEX180', days: 180, maxUses: 40 },
    { code: 'LEGEND180', days: 180, maxUses: 30 },
    { code: 'CROWN180', days: 180, maxUses: 30 },
    // 365-day codes
    { code: 'OMNIYEAR', days: 365, maxUses: 75 },
    { code: 'YEAR2024', days: 365, maxUses: 75 },
    { code: 'GIFTYEAR', days: 365, maxUses: 50 },
    { code: 'VIPYEAR', days: 365, maxUses: 30 },
    { code: 'ELITEYEAR', days: 365, maxUses: 25 },
    { code: 'PRIMEYEAR', days: 365, maxUses: 25 },
    { code: 'ULTRAYEAR', days: 365, maxUses: 20 },
    { code: 'LEGENDYEAR', days: 365, maxUses: 15 },
    { code: 'CROWNYEAR', days: 365, maxUses: 10 },
    { code: 'OMNIGOLD', days: 365, maxUses: 50 },
    // Special/event codes
    { code: 'LAUNCH', days: 30, maxUses: 9999 },
    { code: 'WELCOME', days: 14, maxUses: 9999 },
    { code: 'FRIENDS', days: 7, maxUses: 9999 },
    { code: 'EARLYBIRD', days: 30, maxUses: 500 },
    { code: 'BETA2024', days: 14, maxUses: 9999 },
    { code: 'OMNIBETA', days: 30, maxUses: 9999 },
    { code: 'OMNISTART', days: 7, maxUses: 9999 },
    { code: 'NEWUSER', days: 7, maxUses: 9999 },
    { code: 'FIRSTWEEK', days: 7, maxUses: 9999 },
    { code: 'TESTDRIVE', days: 3, maxUses: 9999 },
    { code: 'QUICKTEST', days: 3, maxUses: 9999 },
    { code: 'DEMO3', days: 3, maxUses: 9999 },
    { code: 'PROMO2024', days: 30, maxUses: 300 },
    { code: 'PROMO2025', days: 30, maxUses: 500 },
    { code: 'PROMO2026', days: 30, maxUses: 500 },
    { code: 'OMNILOVE', days: 14, maxUses: 999 },
    { code: 'OMNIFUN', days: 7, maxUses: 999 },
    { code: 'OMNICLUB', days: 30, maxUses: 200 },
    { code: 'OMNIVIP', days: 60, maxUses: 100 },
    { code: 'OMNIKING', days: 90, maxUses: 50 },
    { code: 'OMNIPRO', days: 30, maxUses: 300 },
    { code: 'OMNIXL', days: 60, maxUses: 150 },
    { code: 'OMNIMEGA', days: 180, maxUses: 75 },
    { code: 'OMNIULTRA', days: 365, maxUses: 30 },
    { code: 'OMNIPRIME', days: 90, maxUses: 75 },
    { code: 'OMNIGIFT', days: 14, maxUses: 500 },
    { code: 'OMNIFREE', days: 7, maxUses: 9999 },
  ];
  const insertPromo = db.prepare("INSERT OR IGNORE INTO promo_codes (code, type, days, max_uses, uses, expires_at) VALUES (?, 'free_premium', ?, ?, 0, NULL)");
  let promoCount = 0;
  for (const p of PROMO_LIST) {
    const r = insertPromo.run(p.code, p.days, p.maxUses);
    if (r.changes > 0) promoCount++;
  }
  if (promoCount > 0) console.log(`[init] Добавлено ${promoCount} новых промокодов`);
})();

// ─── Express ─────────────────────────────────────────────────────────────────

const app = express();

app.use(cors({ origin: "*", methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"] }));
app.use(express.json({ limit: "550mb" }));
app.use(express.urlencoded({ extended: true, limit: "550mb" }));
app.use("/uploads", express.static(UPLOADS_DIR));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: PREMIUM_FILE_SIZE_MB * 1024 * 1024 },
});

// ─── Middleware ───────────────────────────────────────────────────────────────

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Требуется авторизация" });
  }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET);
    const user = stmts.findUserById.get(payload.userId);
    if (!user) return res.status(401).json({ error: "Пользователь не найден" });
    const mod = db.prepare("SELECT * FROM user_moderation WHERE user_id = ?").get(user.id);
    if (mod?.is_banned) {
      return res.status(403).json({
        error: mod.ban_reason || "Ваш аккаунт заблокирован администратором",
        code: "ACCOUNT_BANNED",
      });
    }
    req.user = user;
    req.userMod = mod || null;
    next();
  } catch {
    return res.status(401).json({ error: "Неверный токен" });
  }
}

function requireServerAdmin(req, res, next) {
  const server = stmts.getServer.get(req.params.serverId || req.params.id);
  if (!server) return res.status(404).json({ error: "Сервер не найден" });
  if (!canManageServer(server, req.user.id)) {
    return res.status(403).json({ error: "Недостаточно прав" });
  }
  req.server = server;
  next();
}

// ─── Служебные эндпоинты ──────────────────────────────────────────────────────

app.get("/api/healthz", (_req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

app.get("/api/version", (_req, res) => {
  res.json({
    serverVersion: SERVER_VERSION,
    updateUrl: UPDATE_URL,
    message: `✅ Сервер Omni v${SERVER_VERSION}`,
    features: ["premium", "servers", "channels", "roles", "reactions"],
  });
});

// ─── Веб-мессенджер (встроенный HTML) ───────────────────────────────────────
const WEB_HTML = Buffer.from('PCFET0NUWVBFIGh0bWw+CjxodG1sIGxhbmc9InJ1Ij4KPGhlYWQ+CjxtZXRhIGNoYXJzZXQ9IlVURi04Ii8+CjxtZXRhIG5hbWU9InZpZXdwb3J0IiBjb250ZW50PSJ3aWR0aD1kZXZpY2Utd2lkdGgsIGluaXRpYWwtc2NhbGU9MS4wIi8+Cjx0aXRsZT5PbW5pIOKAlCDQnNC10YHRgdC10L3QtNC20LXRgDwvdGl0bGU+CjxsaW5rIHJlbD0icHJlY29ubmVjdCIgaHJlZj0iaHR0cHM6Ly9mb250cy5nb29nbGVhcGlzLmNvbSIvPgo8bGluayBocmVmPSJodHRwczovL2ZvbnRzLmdvb2dsZWFwaXMuY29tL2NzczI/ZmFtaWx5PUludGVyOndnaHRANDAwOzUwMDs2MDA7NzAwJmRpc3BsYXk9c3dhcCIgcmVsPSJzdHlsZXNoZWV0Ii8+CjxzdHlsZT4KKntib3gtc2l6aW5nOmJvcmRlci1ib3g7bWFyZ2luOjA7cGFkZGluZzowfQo6cm9vdHsKICAtLWJnMDojMGIwYjEzOy0tYmcxOiMxMTExMTk7LS1iZzI6IzE3MTcxZjstLWJnMzojMWUxZTI4Oy0tYmc0OiMyNTI1MzA7CiAgLS1ib3JkZXI6IzJhMmEzODstLXRleHQ6I2U0ZTRmMDstLXRleHQyOiM5NTk1YWE7LS10ZXh0MzojNWE1YTcyOwogIC0tYWNjZW50OiM3YzNhZWQ7LS1hY2NlbnQyOiM2ZDI4ZDk7LS1hY2NlbnQtZ2xvdzpyZ2JhKDEyNCw1OCwyMzcsLjM1KTsKICAtLWdyZWVuOiMyMmM1NWU7LS1yZWQ6I2VmNDQ0NDstLXllbGxvdzojZjU5ZTBiOy0tY3lhbjojMjJkM2VlOwogIC0tZ29sZDojZmZkNzAwOy0tcmFkaXVzOjEycHg7LS1yYWRpdXMtc206OHB4Owp9CmJvZHl7Zm9udC1mYW1pbHk6J0ludGVyJyxzYW5zLXNlcmlmO2JhY2tncm91bmQ6dmFyKC0tYmcwKTtjb2xvcjp2YXIoLS10ZXh0KTtoZWlnaHQ6MTAwdmg7b3ZlcmZsb3c6aGlkZGVuO2Rpc3BsYXk6ZmxleH0KLyogc2Nyb2xsYmFyICovCjo6LXdlYmtpdC1zY3JvbGxiYXJ7d2lkdGg6NHB4O2hlaWdodDo0cHh9Cjo6LXdlYmtpdC1zY3JvbGxiYXItdHJhY2t7YmFja2dyb3VuZDp0cmFuc3BhcmVudH0KOjotd2Via2l0LXNjcm9sbGJhci10aHVtYntiYWNrZ3JvdW5kOnZhcigtLWJvcmRlcik7Ym9yZGVyLXJhZGl1czo0cHh9Ci8qIOKUgOKUgCBBVVRIIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCAqLwojYXV0aC1zY3JlZW57cG9zaXRpb246Zml4ZWQ7aW5zZXQ6MDtiYWNrZ3JvdW5kOnZhcigtLWJnMCk7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO3otaW5kZXg6MTAwMH0KLmF1dGgtYm94e2JhY2tncm91bmQ6dmFyKC0tYmcyKTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlcik7Ym9yZGVyLXJhZGl1czoyMHB4O3BhZGRpbmc6NDBweDt3aWR0aDoxMDAlO21heC13aWR0aDo0MjBweDtib3gtc2hhZG93OjAgMzBweCA4MHB4IHJnYmEoMCwwLDAsLjYpfQouYXV0aC1sb2dve3RleHQtYWxpZ246Y2VudGVyO21hcmdpbi1ib3R0b206MjhweH0KLmF1dGgtbG9nbyBoMXtmb250LXNpemU6MjhweDtmb250LXdlaWdodDo3MDA7YmFja2dyb3VuZDpsaW5lYXItZ3JhZGllbnQoMTM1ZGVnLCNhNzhiZmEsIzdjM2FlZCk7LXdlYmtpdC1iYWNrZ3JvdW5kLWNsaXA6dGV4dDstd2Via2l0LXRleHQtZmlsbC1jb2xvcjp0cmFuc3BhcmVudH0KLmF1dGgtbG9nbyBwe2NvbG9yOnZhcigtLXRleHQyKTtmb250LXNpemU6MTNweDttYXJnaW4tdG9wOjZweH0KLmF1dGgtdGFic3tkaXNwbGF5OmZsZXg7Z2FwOjRweDtiYWNrZ3JvdW5kOnZhcigtLWJnMyk7Ym9yZGVyLXJhZGl1czp2YXIoLS1yYWRpdXMtc20pO3BhZGRpbmc6NHB4O21hcmdpbi1ib3R0b206MjRweH0KLmF1dGgtdGFie2ZsZXg6MTt0ZXh0LWFsaWduOmNlbnRlcjtwYWRkaW5nOjhweDtib3JkZXItcmFkaXVzOjZweDtjdXJzb3I6cG9pbnRlcjtmb250LXNpemU6MTRweDtmb250LXdlaWdodDo1MDA7Y29sb3I6dmFyKC0tdGV4dDIpO3RyYW5zaXRpb246LjJzfQouYXV0aC10YWIuYWN0aXZle2JhY2tncm91bmQ6dmFyKC0tYWNjZW50KTtjb2xvcjojZmZmfQouZm9ybS1ncm91cHttYXJnaW4tYm90dG9tOjE2cHh9Ci5mb3JtLWdyb3VwIGxhYmVse2Rpc3BsYXk6YmxvY2s7Zm9udC1zaXplOjEycHg7Zm9udC13ZWlnaHQ6NjAwO2NvbG9yOnZhcigtLXRleHQyKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjZweDttYXJnaW4tYm90dG9tOjZweH0KLmZvcm0tZ3JvdXAgaW5wdXR7d2lkdGg6MTAwJTtiYWNrZ3JvdW5kOnZhcigtLWJnMyk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXIpO2JvcmRlci1yYWRpdXM6dmFyKC0tcmFkaXVzLXNtKTtwYWRkaW5nOjExcHggMTRweDtjb2xvcjp2YXIoLS10ZXh0KTtmb250LXNpemU6MTVweDtmb250LWZhbWlseTppbmhlcml0O291dGxpbmU6bm9uZTt0cmFuc2l0aW9uOi4yc30KLmZvcm0tZ3JvdXAgaW5wdXQ6Zm9jdXN7Ym9yZGVyLWNvbG9yOnZhcigtLWFjY2VudCk7Ym94LXNoYWRvdzowIDAgMCAzcHggdmFyKC0tYWNjZW50LWdsb3cpfQouYnRue3dpZHRoOjEwMCU7cGFkZGluZzoxMnB4O2JvcmRlci1yYWRpdXM6dmFyKC0tcmFkaXVzLXNtKTtib3JkZXI6bm9uZTtmb250LXNpemU6MTVweDtmb250LXdlaWdodDo2MDA7Zm9udC1mYW1pbHk6aW5oZXJpdDtjdXJzb3I6cG9pbnRlcjt0cmFuc2l0aW9uOi4yc30KLmJ0bi1wcmltYXJ5e2JhY2tncm91bmQ6dmFyKC0tYWNjZW50KTtjb2xvcjojZmZmfQouYnRuLXByaW1hcnk6aG92ZXJ7YmFja2dyb3VuZDp2YXIoLS1hY2NlbnQyKX0KLmJ0bi1wcmltYXJ5OmRpc2FibGVke29wYWNpdHk6LjU7Y3Vyc29yOmRlZmF1bHR9Ci5hdXRoLWVycm9ye2NvbG9yOnZhcigtLXJlZCk7Zm9udC1zaXplOjEzcHg7bWFyZ2luLXRvcDoxMnB4O3RleHQtYWxpZ246Y2VudGVyO21pbi1oZWlnaHQ6MjBweH0KLyog4pSA4pSAIExBWU9VVCDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAgKi8KI2FwcHtkaXNwbGF5OmZsZXg7d2lkdGg6MTAwJTtoZWlnaHQ6MTAwdmg7ZGlzcGxheTpub25lfQovKiBpY29uIHJhaWwgKi8KLnJhaWx7d2lkdGg6NjhweDtiYWNrZ3JvdW5kOnZhcigtLWJnMSk7ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjthbGlnbi1pdGVtczpjZW50ZXI7cGFkZGluZzoxMnB4IDA7Z2FwOjRweDtib3JkZXItcmlnaHQ6MXB4IHNvbGlkIHZhcigtLWJvcmRlcik7ZmxleC1zaHJpbms6MH0KLnJhaWwtYnRue3dpZHRoOjQ0cHg7aGVpZ2h0OjQ0cHg7Ym9yZGVyLXJhZGl1czo1MCU7Ym9yZGVyOm5vbmU7YmFja2dyb3VuZDp2YXIoLS1iZzMpO2N1cnNvcjpwb2ludGVyO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0Mik7dHJhbnNpdGlvbjouMnM7cG9zaXRpb246cmVsYXRpdmV9Ci5yYWlsLWJ0bjpob3ZlcntiYWNrZ3JvdW5kOnZhcigtLWFjY2VudCk7Y29sb3I6I2ZmZjtib3JkZXItcmFkaXVzOjE0cHh9Ci5yYWlsLWJ0bi5hY3RpdmV7YmFja2dyb3VuZDp2YXIoLS1hY2NlbnQpO2NvbG9yOiNmZmY7Ym9yZGVyLXJhZGl1czoxNHB4fQoucmFpbC1idG4gc3Zne3dpZHRoOjIycHg7aGVpZ2h0OjIycHh9Ci5yYWlsLXNlcHt3aWR0aDozMnB4O2hlaWdodDoycHg7YmFja2dyb3VuZDp2YXIoLS1ib3JkZXIpO2JvcmRlci1yYWRpdXM6MnB4O21hcmdpbjo2cHggMH0KLnJhaWwtYXZhdGFye3dpZHRoOjQ0cHg7aGVpZ2h0OjQ0cHg7Ym9yZGVyLXJhZGl1czo1MCU7Ym9yZGVyOjJweCBzb2xpZCB2YXIoLS1ib3JkZXIpO2N1cnNvcjpwb2ludGVyO292ZXJmbG93OmhpZGRlbjtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7YmFja2dyb3VuZDp2YXIoLS1hY2NlbnQpO2NvbG9yOiNmZmY7Zm9udC13ZWlnaHQ6NzAwO2ZvbnQtc2l6ZToxNnB4O3RyYW5zaXRpb246LjJzO21hcmdpbi10b3A6YXV0b30KLnJhaWwtYXZhdGFyOmhvdmVye2JvcmRlci1jb2xvcjp2YXIoLS1hY2NlbnQpfQoucmFpbC1hdmF0YXIgaW1ne3dpZHRoOjEwMCU7aGVpZ2h0OjEwMCU7b2JqZWN0LWZpdDpjb3Zlcn0KLyogYmFkZ2UgKi8KLmJhZGdle3Bvc2l0aW9uOmFic29sdXRlO3RvcDotMnB4O3JpZ2h0Oi0ycHg7YmFja2dyb3VuZDp2YXIoLS1yZWQpO2NvbG9yOiNmZmY7Zm9udC1zaXplOjEwcHg7Zm9udC13ZWlnaHQ6NzAwO21pbi13aWR0aDoxNnB4O2hlaWdodDoxNnB4O2JvcmRlci1yYWRpdXM6OHB4O2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtwYWRkaW5nOjAgNHB4O2JvcmRlcjoycHggc29saWQgdmFyKC0tYmcxKX0KLyogcGFuZWxzICovCi5wYW5lbHtkaXNwbGF5Om5vbmU7ZmxleDoxO2hlaWdodDoxMDB2aDtvdmVyZmxvdzpoaWRkZW59Ci5wYW5lbC5hY3RpdmV7ZGlzcGxheTpmbGV4fQovKiDilIDilIAgRE0gUEFORUwg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAICovCi5kbS1wYW5lbHtmbGV4OjE7ZGlzcGxheTpmbGV4O2hlaWdodDoxMDAlfQouY29udi1zaWRlYmFye3dpZHRoOjI2MHB4O2ZsZXgtc2hyaW5rOjA7YmFja2dyb3VuZDp2YXIoLS1iZzEpO2JvcmRlci1yaWdodDoxcHggc29saWQgdmFyKC0tYm9yZGVyKTtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1ufQouc2lkZWJhci1oZWFkZXJ7cGFkZGluZzoxNnB4O2JvcmRlci1ib3R0b206MXB4IHNvbGlkIHZhcigtLWJvcmRlcil9Ci5zaWRlYmFyLWhlYWRlciBoMntmb250LXNpemU6MTZweDtmb250LXdlaWdodDo3MDA7bWFyZ2luLWJvdHRvbToxMHB4fQouc2VhcmNoLWJveHtwb3NpdGlvbjpyZWxhdGl2ZX0KLnNlYXJjaC1ib3ggaW5wdXR7d2lkdGg6MTAwJTtiYWNrZ3JvdW5kOnZhcigtLWJnMyk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXIpO2JvcmRlci1yYWRpdXM6dmFyKC0tcmFkaXVzLXNtKTtwYWRkaW5nOjhweCAxMnB4IDhweCAzNnB4O2NvbG9yOnZhcigtLXRleHQpO2ZvbnQtc2l6ZToxM3B4O2ZvbnQtZmFtaWx5OmluaGVyaXQ7b3V0bGluZTpub25lfQouc2VhcmNoLWJveDo6YmVmb3Jle2NvbnRlbnQ6J/CflI0nO3Bvc2l0aW9uOmFic29sdXRlO2xlZnQ6MTBweDt0b3A6NTAlO3RyYW5zZm9ybTp0cmFuc2xhdGVZKC01MCUpO2ZvbnQtc2l6ZToxM3B4fQouY29udi1saXN0e2ZsZXg6MTtvdmVyZmxvdy15OmF1dG87cGFkZGluZzo4cHggMH0KLmNvbnYtaXRlbXtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoxMHB4O3BhZGRpbmc6MTBweCAxMnB4O2N1cnNvcjpwb2ludGVyO3RyYW5zaXRpb246LjE1cztwb3NpdGlvbjpyZWxhdGl2ZX0KLmNvbnYtaXRlbTpob3ZlcntiYWNrZ3JvdW5kOnZhcigtLWJnMyl9Ci5jb252LWl0ZW0uYWN0aXZle2JhY2tncm91bmQ6dmFyKC0tYmczKTtib3JkZXItbGVmdDozcHggc29saWQgdmFyKC0tYWNjZW50KX0KLmNvbnYtYXZhdGFye3dpZHRoOjQwcHg7aGVpZ2h0OjQwcHg7Ym9yZGVyLXJhZGl1czo1MCU7YmFja2dyb3VuZDp2YXIoLS1hY2NlbnQpO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtmb250LXdlaWdodDo3MDA7Zm9udC1zaXplOjE2cHg7ZmxleC1zaHJpbms6MDtvdmVyZmxvdzpoaWRkZW59Ci5jb252LWF2YXRhciBpbWd7d2lkdGg6MTAwJTtoZWlnaHQ6MTAwJTtvYmplY3QtZml0OmNvdmVyfQouY29udi1pbmZve2ZsZXg6MTttaW4td2lkdGg6MH0KLmNvbnYtbmFtZXtmb250LXNpemU6MTRweDtmb250LXdlaWdodDo2MDA7d2hpdGUtc3BhY2U6bm93cmFwO292ZXJmbG93OmhpZGRlbjt0ZXh0LW92ZXJmbG93OmVsbGlwc2lzfQouY29udi1wcmV2aWV3e2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQyKTt3aGl0ZS1zcGFjZTpub3dyYXA7b3ZlcmZsb3c6aGlkZGVuO3RleHQtb3ZlcmZsb3c6ZWxsaXBzaXM7bWFyZ2luLXRvcDoycHh9Ci5jb252LW1ldGF7ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjthbGlnbi1pdGVtczpmbGV4LWVuZDtnYXA6NHB4fQouY29udi10aW1le2ZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLXRleHQzKX0KLmNvbnYtdW5yZWFke3dpZHRoOjE4cHg7aGVpZ2h0OjE4cHg7YmFja2dyb3VuZDp2YXIoLS1hY2NlbnQpO2JvcmRlci1yYWRpdXM6OXB4O2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtmb250LXNpemU6MTBweDtmb250LXdlaWdodDo3MDA7Y29sb3I6I2ZmZn0KLyogY2hhdCBhcmVhICovCi5jaGF0LWFyZWF7ZmxleDoxO2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47YmFja2dyb3VuZDp2YXIoLS1iZzApfQouY2hhdC1oZWFkZXJ7cGFkZGluZzoxNHB4IDIwcHg7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgdmFyKC0tYm9yZGVyKTtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoxMnB4O2JhY2tncm91bmQ6dmFyKC0tYmcxKX0KLmNoYXQtaGVhZGVyLWF2YXRhcnt3aWR0aDozNnB4O2hlaWdodDozNnB4O2JvcmRlci1yYWRpdXM6NTAlO2JhY2tncm91bmQ6dmFyKC0tYWNjZW50KTtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7Zm9udC13ZWlnaHQ6NzAwO292ZXJmbG93OmhpZGRlbn0KLmNoYXQtaGVhZGVyLWF2YXRhciBpbWd7d2lkdGg6MTAwJTtoZWlnaHQ6MTAwJTtvYmplY3QtZml0OmNvdmVyfQouY2hhdC1oZWFkZXItbmFtZXtmb250LXNpemU6MTZweDtmb250LXdlaWdodDo3MDB9Ci5jaGF0LWhlYWRlci1zdGF0dXN7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tZ3JlZW4pO21hcmdpbi10b3A6MXB4fQouY2hhdC1oZWFkZXItc3RhdHVzLm9mZmxpbmV7Y29sb3I6dmFyKC0tdGV4dDMpfQouY2hhdC1tZXNzYWdlc3tmbGV4OjE7b3ZlcmZsb3cteTphdXRvO3BhZGRpbmc6MTZweCAyMHB4O2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47Z2FwOjJweH0KLmNoYXQtZW1wdHl7ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtoZWlnaHQ6MTAwJTtjb2xvcjp2YXIoLS10ZXh0Myk7Z2FwOjEycHh9Ci5jaGF0LWVtcHR5IHN2Z3t3aWR0aDo2NHB4O2hlaWdodDo2NHB4O29wYWNpdHk6LjN9Ci5tc2d7ZGlzcGxheTpmbGV4O2dhcDoxMHB4O3BhZGRpbmc6NHB4IDA7YWxpZ24taXRlbXM6ZmxleC1zdGFydH0KLm1zZzpob3ZlcntiYWNrZ3JvdW5kOnZhcigtLWJnMSk7Ym9yZGVyLXJhZGl1czo4cHg7cGFkZGluZzo0cHggOHB4O21hcmdpbjowIC04cHh9Ci5tc2ctYXZhdGFye3dpZHRoOjM2cHg7aGVpZ2h0OjM2cHg7Ym9yZGVyLXJhZGl1czo1MCU7YmFja2dyb3VuZDp2YXIoLS1hY2NlbnQpO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtmb250LXNpemU6MTRweDtmb250LXdlaWdodDo3MDA7ZmxleC1zaHJpbms6MDtvdmVyZmxvdzpoaWRkZW47bWFyZ2luLXRvcDoycHh9Ci5tc2ctYXZhdGFyIGltZ3t3aWR0aDoxMDAlO2hlaWdodDoxMDAlO29iamVjdC1maXQ6Y292ZXJ9Ci5tc2ctYm9keXtmbGV4OjE7bWluLXdpZHRoOjB9Ci5tc2ctaGVhZGVye2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpiYXNlbGluZTtnYXA6OHB4O21hcmdpbi1ib3R0b206M3B4fQoubXNnLWF1dGhvcntmb250LXNpemU6MTRweDtmb250LXdlaWdodDo2MDB9Ci5tc2ctYXV0aG9yLmJvdHtjb2xvcjojZjU5ZTBifQoubXNnLXRpbWV7Zm9udC1zaXplOjExcHg7Y29sb3I6dmFyKC0tdGV4dDMpfQoubXNnLXRleHR7Zm9udC1zaXplOjE1cHg7bGluZS1oZWlnaHQ6MS41O3dvcmQtYnJlYWs6YnJlYWstd29yZDtjb2xvcjp2YXIoLS10ZXh0KX0KLm1zZy10ZXh0LmRlbGV0ZWR7Y29sb3I6dmFyKC0tdGV4dDMpO2ZvbnQtc3R5bGU6aXRhbGljfQovKiBnaWZ0IGJ1YmJsZSAqLwouZ2lmdC1idWJibGV7YmFja2dyb3VuZDpsaW5lYXItZ3JhZGllbnQoMTM1ZGVnLCMxYTBhM2EsIzEyMDgyMCk7Ym9yZGVyOjFweCBzb2xpZCByZ2JhKDEyNCw1OCwyMzcsLjQpO2JvcmRlci1yYWRpdXM6MTZweDtwYWRkaW5nOjE2cHggMjBweDtkaXNwbGF5OmlubGluZS1mbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MTRweDttYXJnaW4tdG9wOjRweDttYXgtd2lkdGg6MzIwcHg7Y3Vyc29yOnBvaW50ZXI7dHJhbnNpdGlvbjouMnN9Ci5naWZ0LWJ1YmJsZTpob3Zlcntib3JkZXItY29sb3I6dmFyKC0tYWNjZW50KTtib3gtc2hhZG93OjAgMCAyMHB4IHZhcigtLWFjY2VudC1nbG93KX0KLmdpZnQtZW1vaml7Zm9udC1zaXplOjM2cHg7bGluZS1oZWlnaHQ6MX0KLmdpZnQtaW5mbyBoNHtmb250LXNpemU6MTVweDtmb250LXdlaWdodDo3MDA7Y29sb3I6I2ZmZn0KLmdpZnQtaW5mbyBwe2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQyKTttYXJnaW4tdG9wOjNweH0KLmdpZnQtcmFyaXR5e2Rpc3BsYXk6aW5saW5lLWJsb2NrO2ZvbnQtc2l6ZToxMHB4O2ZvbnQtd2VpZ2h0OjcwMDtwYWRkaW5nOjJweCA4cHg7Ym9yZGVyLXJhZGl1czoxMHB4O21hcmdpbi10b3A6NnB4O3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNXB4fQouZ2lmdC1yYXJpdHkuY29tbW9ue2JhY2tncm91bmQ6cmdiYSgyNTUsMjU1LDI1NSwuMSk7Y29sb3I6I2FhYX0KLmdpZnQtcmFyaXR5LnJhcmV7YmFja2dyb3VuZDpyZ2JhKDU5LDEzMCwyNDYsLjIpO2NvbG9yOiM2MGE1ZmF9Ci5naWZ0LXJhcml0eS5lcGlje2JhY2tncm91bmQ6cmdiYSgxMjQsNTgsMjM3LC4yNSk7Y29sb3I6I2E3OGJmYX0KLmdpZnQtcmFyaXR5LmxlZ2VuZGFyeXtiYWNrZ3JvdW5kOnJnYmEoMjU1LDIxNSwwLC4xNSk7Y29sb3I6I2ZiYmYyNH0KLyogaW5wdXQgYXJlYSAqLwouY2hhdC1pbnB1dC13cmFwe3BhZGRpbmc6MTJweCAyMHB4IDE2cHg7Ym9yZGVyLXRvcDoxcHggc29saWQgdmFyKC0tYm9yZGVyKX0KLmNoYXQtaW5wdXQtYm94e2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjhweDtiYWNrZ3JvdW5kOnZhcigtLWJnMyk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXIpO2JvcmRlci1yYWRpdXM6MTJweDtwYWRkaW5nOjhweCAxMnB4O3RyYW5zaXRpb246LjJzfQouY2hhdC1pbnB1dC1ib3g6Zm9jdXMtd2l0aGlue2JvcmRlci1jb2xvcjp2YXIoLS1hY2NlbnQpfQouY2hhdC1pbnB1dC1ib3ggaW5wdXR7ZmxleDoxO2JhY2tncm91bmQ6bm9uZTtib3JkZXI6bm9uZTtjb2xvcjp2YXIoLS10ZXh0KTtmb250LXNpemU6MTVweDtmb250LWZhbWlseTppbmhlcml0O291dGxpbmU6bm9uZX0KLmNoYXQtaW5wdXQtYm94IGlucHV0OjpwbGFjZWhvbGRlcntjb2xvcjp2YXIoLS10ZXh0Myl9Ci5zZW5kLWJ0bnt3aWR0aDozNnB4O2hlaWdodDozNnB4O2JvcmRlci1yYWRpdXM6OHB4O2JvcmRlcjpub25lO2JhY2tncm91bmQ6dmFyKC0tYWNjZW50KTtjb2xvcjojZmZmO2N1cnNvcjpwb2ludGVyO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjt0cmFuc2l0aW9uOi4ycztmbGV4LXNocmluazowfQouc2VuZC1idG46aG92ZXJ7YmFja2dyb3VuZDp2YXIoLS1hY2NlbnQyKX0KLnNlbmQtYnRuOmRpc2FibGVke29wYWNpdHk6LjQ7Y3Vyc29yOmRlZmF1bHR9Ci5jaGF0LXBsYWNlaG9sZGVye2ZsZXg6MTtkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpjZW50ZXI7ZmxleC1kaXJlY3Rpb246Y29sdW1uO2dhcDoxNnB4O2NvbG9yOnZhcigtLXRleHQzKX0KLmNoYXQtcGxhY2Vob2xkZXIgc3Zne3dpZHRoOjgwcHg7aGVpZ2h0OjgwcHg7b3BhY2l0eTouMn0KLyog4pSA4pSAIFNFUlZFUlMgUEFORUwg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAICovCi5zZXJ2ZXJzLXBhbmVse2ZsZXg6MTtkaXNwbGF5OmZsZXg7aGVpZ2h0OjEwMCV9Ci5zZXJ2ZXItbGlzdC1zaWRlYmFye3dpZHRoOjI2MHB4O2ZsZXgtc2hyaW5rOjA7YmFja2dyb3VuZDp2YXIoLS1iZzEpO2JvcmRlci1yaWdodDoxcHggc29saWQgdmFyKC0tYm9yZGVyKTtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1ufQouc2VydmVyLWNoYW5uZWwtc2lkZWJhcnt3aWR0aDoyMjBweDtmbGV4LXNocmluazowO2JhY2tncm91bmQ6dmFyKC0tYmcyKTtib3JkZXItcmlnaHQ6MXB4IHNvbGlkIHZhcigtLWJvcmRlcik7ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbn0KLnNlcnZlci1jaGFubmVsLXNpZGViYXIgLnNpZGViYXItaGVhZGVye2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47Z2FwOjhweH0KLmNoYW5uZWwtbGlzdHtmbGV4OjE7b3ZlcmZsb3cteTphdXRvO3BhZGRpbmc6OHB4fQouY2hhbm5lbC1zZWN0aW9ue21hcmdpbi1ib3R0b206OHB4fQouY2hhbm5lbC1zZWN0aW9uLW5hbWV7Zm9udC1zaXplOjExcHg7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOnZhcigtLXRleHQzKTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjhweDtwYWRkaW5nOjZweCA4cHh9Ci5jaGFubmVsLWl0ZW17ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6OHB4O3BhZGRpbmc6N3B4IDEwcHg7Ym9yZGVyLXJhZGl1czo2cHg7Y3Vyc29yOnBvaW50ZXI7Y29sb3I6dmFyKC0tdGV4dDIpO3RyYW5zaXRpb246LjE1cztmb250LXNpemU6MTRweH0KLmNoYW5uZWwtaXRlbTpob3ZlcntiYWNrZ3JvdW5kOnZhcigtLWJnMyk7Y29sb3I6dmFyKC0tdGV4dCl9Ci5jaGFubmVsLWl0ZW0uYWN0aXZle2JhY2tncm91bmQ6dmFyKC0tYmc0KTtjb2xvcjp2YXIoLS10ZXh0KX0KLmNoYW5uZWwtaGFzaHtjb2xvcjp2YXIoLS10ZXh0Myk7Zm9udC1zaXplOjE2cHg7Zm9udC13ZWlnaHQ6NzAwfQouY2hhbm5lbC1hcmVhe2ZsZXg6MTtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1ufQouc2VydmVyLWl0ZW17ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MTBweDtwYWRkaW5nOjEwcHggMTRweDtjdXJzb3I6cG9pbnRlcjt0cmFuc2l0aW9uOi4xNXM7cG9zaXRpb246cmVsYXRpdmV9Ci5zZXJ2ZXItaXRlbTpob3ZlcntiYWNrZ3JvdW5kOnZhcigtLWJnMyl9Ci5zZXJ2ZXItaXRlbS5hY3RpdmV7YmFja2dyb3VuZDp2YXIoLS1iZzMpO2JvcmRlci1sZWZ0OjNweCBzb2xpZCB2YXIoLS1hY2NlbnQpfQouc2VydmVyLWljb257d2lkdGg6NDRweDtoZWlnaHQ6NDRweDtib3JkZXItcmFkaXVzOjE0cHg7YmFja2dyb3VuZDp2YXIoLS1iZzQpO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtmb250LXNpemU6MjBweDtmbGV4LXNocmluazowO292ZXJmbG93OmhpZGRlbn0KLnNlcnZlci1pY29uIGltZ3t3aWR0aDoxMDAlO2hlaWdodDoxMDAlO29iamVjdC1maXQ6Y292ZXJ9Ci5zZXJ2ZXItbmFtZXtmb250LXNpemU6MTRweDtmb250LXdlaWdodDo2MDB9Ci5zZXJ2ZXItbWVtYmVyc3tmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS10ZXh0Mil9Ci5jcmVhdGUtc2VydmVyLWJ0bnttYXJnaW46MTBweCAxNHB4O3BhZGRpbmc6MTBweDtib3JkZXItcmFkaXVzOjEwcHg7Ym9yZGVyOjJweCBkYXNoZWQgdmFyKC0tYm9yZGVyKTtiYWNrZ3JvdW5kOm5vbmU7Y29sb3I6dmFyKC0tdGV4dDIpO2N1cnNvcjpwb2ludGVyO2ZvbnQtc2l6ZToxNHB4O2ZvbnQtZmFtaWx5OmluaGVyaXQ7dHJhbnNpdGlvbjouMnM7dGV4dC1hbGlnbjpjZW50ZXJ9Ci5jcmVhdGUtc2VydmVyLWJ0bjpob3Zlcntib3JkZXItY29sb3I6dmFyKC0tYWNjZW50KTtjb2xvcjp2YXIoLS1hY2NlbnQpfQovKiDilIDilIAgU0hPUCBQQU5FTCDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAgKi8KLnNob3AtcGFuZWx7ZmxleDoxO292ZXJmbG93LXk6YXV0bztwYWRkaW5nOjMycHh9Ci5zaG9wLXBhbmVsIGgxe2ZvbnQtc2l6ZToyNnB4O2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW4tYm90dG9tOjZweH0KLnNob3AtcGFuZWwgLnN1YnRpdGxle2NvbG9yOnZhcigtLXRleHQyKTttYXJnaW4tYm90dG9tOjMycHg7Zm9udC1zaXplOjE1cHh9Ci5zaG9wLXRhYnN7ZGlzcGxheTpmbGV4O2dhcDo0cHg7YmFja2dyb3VuZDp2YXIoLS1iZzIpO2JvcmRlci1yYWRpdXM6MTBweDtwYWRkaW5nOjRweDttYXJnaW4tYm90dG9tOjI4cHg7d2lkdGg6Zml0LWNvbnRlbnQ7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXIpfQouc2hvcC10YWJ7cGFkZGluZzo4cHggMjBweDtib3JkZXItcmFkaXVzOjhweDtjdXJzb3I6cG9pbnRlcjtmb250LXNpemU6MTRweDtmb250LXdlaWdodDo2MDA7Y29sb3I6dmFyKC0tdGV4dDIpO3RyYW5zaXRpb246LjJzfQouc2hvcC10YWIuYWN0aXZle2JhY2tncm91bmQ6dmFyKC0tYWNjZW50KTtjb2xvcjojZmZmfQovKiBwcmVtaXVtIGNhcmQgKi8KLnByZW1pdW0taGVyb3tiYWNrZ3JvdW5kOmxpbmVhci1ncmFkaWVudCgxMzVkZWcsIzFhMGEzYSwjMGQwNTI1KTtib3JkZXI6MXB4IHNvbGlkIHJnYmEoMTI0LDU4LDIzNywuNCk7Ym9yZGVyLXJhZGl1czoyMHB4O3BhZGRpbmc6MjhweDttYXJnaW4tYm90dG9tOjI0cHg7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MjBweH0KLnByZW1pdW0tY3Jvd257Zm9udC1zaXplOjUycHh9Ci5wcmVtaXVtLWhlcm8gaDJ7Zm9udC1zaXplOjIycHg7Zm9udC13ZWlnaHQ6NzAwO21hcmdpbi1ib3R0b206NnB4fQoucHJlbWl1bS1oZXJvIHB7Y29sb3I6dmFyKC0tdGV4dDIpO2ZvbnQtc2l6ZToxNHB4O2xpbmUtaGVpZ2h0OjEuNX0KLnByZW1pdW0taGVybyAucHJpY2UtdGFne2ZvbnQtc2l6ZToyOHB4O2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjojYTc4YmZhO21hcmdpbi10b3A6MTBweH0KLnByZW1pdW0taGVybyAucHJpY2UtdGFnIHNwYW57Zm9udC1zaXplOjE0cHg7Y29sb3I6dmFyKC0tdGV4dDIpO2ZvbnQtd2VpZ2h0OjQwMH0KLmZlYXR1cmVzLWdyaWR7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoYXV0by1maWxsLG1pbm1heCgyMDBweCwxZnIpKTtnYXA6MTJweDttYXJnaW4tYm90dG9tOjI0cHh9Ci5mZWF0dXJlLWNhcmR7YmFja2dyb3VuZDp2YXIoLS1iZzIpO2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyKTtib3JkZXItcmFkaXVzOjEycHg7cGFkZGluZzoxNnB4O2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpmbGV4LXN0YXJ0O2dhcDoxMnB4fQouZmVhdHVyZS1pY29ue2ZvbnQtc2l6ZToyNHB4fQouZmVhdHVyZS1jYXJkIGg0e2ZvbnQtc2l6ZToxNHB4O2ZvbnQtd2VpZ2h0OjYwMH0KLmZlYXR1cmUtY2FyZCBwe2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQyKTttYXJnaW4tdG9wOjRweDtsaW5lLWhlaWdodDoxLjR9Ci8qIGNvaW4gcGFja2FnZXMgKi8KLmNvaW5zLWdyaWR7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoYXV0by1maWxsLG1pbm1heCgxODBweCwxZnIpKTtnYXA6MTZweDttYXJnaW4tYm90dG9tOjMycHh9Ci5jb2luLWNhcmR7YmFja2dyb3VuZDp2YXIoLS1iZzIpO2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyKTtib3JkZXItcmFkaXVzOjE2cHg7cGFkZGluZzoyMHB4O3RleHQtYWxpZ246Y2VudGVyO3RyYW5zaXRpb246LjJzO2N1cnNvcjpwb2ludGVyO3Bvc2l0aW9uOnJlbGF0aXZlfQouY29pbi1jYXJkOmhvdmVye2JvcmRlci1jb2xvcjp2YXIoLS1hY2NlbnQpO2JveC1zaGFkb3c6MCAwIDIwcHggdmFyKC0tYWNjZW50LWdsb3cpfQouY29pbi1jYXJkLnBvcHVsYXI6OmJlZm9yZXtjb250ZW50OidQT1BVTEFSJztwb3NpdGlvbjphYnNvbHV0ZTt0b3A6LTEwcHg7bGVmdDo1MCU7dHJhbnNmb3JtOnRyYW5zbGF0ZVgoLTUwJSk7YmFja2dyb3VuZDp2YXIoLS1hY2NlbnQpO2NvbG9yOiNmZmY7Zm9udC1zaXplOjEwcHg7Zm9udC13ZWlnaHQ6NzAwO3BhZGRpbmc6M3B4IDEwcHg7Ym9yZGVyLXJhZGl1czoxMHB4O2xldHRlci1zcGFjaW5nOi41cHh9Ci5jb2luLWFtb3VudHtmb250LXNpemU6MzJweDtmb250LXdlaWdodDo3MDA7Y29sb3I6dmFyKC0teWVsbG93KX0KLmNvaW4tbGFiZWx7Zm9udC1zaXplOjEzcHg7Y29sb3I6dmFyKC0tdGV4dDIpO21hcmdpbi10b3A6NHB4fQouY29pbi1wcmljZXtmb250LXNpemU6MjBweDtmb250LXdlaWdodDo3MDA7bWFyZ2luLXRvcDoxMnB4fQouY29pbi1idG57bWFyZ2luLXRvcDoxMnB4O3BhZGRpbmc6OHB4IDIwcHg7Ym9yZGVyLXJhZGl1czo4cHg7Ym9yZGVyOm5vbmU7YmFja2dyb3VuZDp2YXIoLS1hY2NlbnQpO2NvbG9yOiNmZmY7Zm9udC1zaXplOjEzcHg7Zm9udC13ZWlnaHQ6NjAwO2N1cnNvcjpwb2ludGVyO2ZvbnQtZmFtaWx5OmluaGVyaXQ7dHJhbnNpdGlvbjouMnM7d2lkdGg6MTAwJX0KLmNvaW4tYnRuOmhvdmVye2JhY2tncm91bmQ6dmFyKC0tYWNjZW50Mil9Ci8qIGdpZnRzIGdyaWQgKi8KLmdpZnRzLWhlYWRlcntkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoxMnB4O21hcmdpbi1ib3R0b206MjBweH0KLmNvaW5zLWJhbGFuY2UtYmFye2JhY2tncm91bmQ6dmFyKC0tYmcyKTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlcik7Ym9yZGVyLXJhZGl1czoxMnB4O3BhZGRpbmc6MTJweCAxOHB4O2Rpc3BsYXk6aW5saW5lLWZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2dhcDoxMHB4O2ZvbnQtd2VpZ2h0OjcwMDtmb250LXNpemU6MTVweH0KLmdpZnRzLWdyaWR7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoYXV0by1maWxsLG1pbm1heCgxNjBweCwxZnIpKTtnYXA6MTZweH0KLmdpZnQtY2FyZHtiYWNrZ3JvdW5kOnZhcigtLWJnMik7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXIpO2JvcmRlci1yYWRpdXM6MTZweDtwYWRkaW5nOjIwcHg7dGV4dC1hbGlnbjpjZW50ZXI7dHJhbnNpdGlvbjouMnM7Y3Vyc29yOnBvaW50ZXJ9Ci5naWZ0LWNhcmQ6aG92ZXJ7Ym9yZGVyLWNvbG9yOnZhcigtLWFjY2VudCk7dHJhbnNmb3JtOnRyYW5zbGF0ZVkoLTJweCk7Ym94LXNoYWRvdzowIDEwcHggMzBweCByZ2JhKDAsMCwwLC4zKX0KLmdpZnQtY2FyZCAuZ2lmdC1iaWctZW1vaml7Zm9udC1zaXplOjQ4cHg7bWFyZ2luLWJvdHRvbToxMnB4fQouZ2lmdC1jYXJkIGg0e2ZvbnQtc2l6ZToxNXB4O2ZvbnQtd2VpZ2h0OjcwMH0KLmdpZnQtY2FyZCBwe2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQyKTttYXJnaW4tdG9wOjRweH0KLmdpZnQtY2FyZCAuZ2lmdC1jb3N0e2ZvbnQtc2l6ZToxNHB4O2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjp2YXIoLS15ZWxsb3cpO21hcmdpbi10b3A6OHB4fQouZ2lmdC1jYXJkIC5naWZ0LWJ1eS1idG57bWFyZ2luLXRvcDoxMnB4O3dpZHRoOjEwMCU7cGFkZGluZzo4cHg7Ym9yZGVyLXJhZGl1czo4cHg7Ym9yZGVyOm5vbmU7YmFja2dyb3VuZDp2YXIoLS1hY2NlbnQpO2NvbG9yOiNmZmY7Zm9udC1zaXplOjEzcHg7Zm9udC13ZWlnaHQ6NjAwO2N1cnNvcjpwb2ludGVyO2ZvbnQtZmFtaWx5OmluaGVyaXQ7dHJhbnNpdGlvbjouMnN9Ci5naWZ0LWNhcmQgLmdpZnQtYnV5LWJ0bjpob3ZlcntiYWNrZ3JvdW5kOnZhcigtLWFjY2VudDIpfQovKiDilIDilIAgUFJPRklMRSBQQU5FTCDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAgKi8KLnByb2ZpbGUtcGFuZWx7ZmxleDoxO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtwYWRkaW5nOjMycHg7b3ZlcmZsb3cteTphdXRvfQoucHJvZmlsZS1jYXJke2JhY2tncm91bmQ6dmFyKC0tYmcyKTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJvcmRlcik7Ym9yZGVyLXJhZGl1czoyMHB4O3BhZGRpbmc6MzJweDt3aWR0aDoxMDAlO21heC13aWR0aDo1MDBweH0KLnByb2ZpbGUtYXZhdGFyLXdyYXB7dGV4dC1hbGlnbjpjZW50ZXI7bWFyZ2luLWJvdHRvbToyNHB4fQoucHJvZmlsZS1iaWctYXZhdGFye3dpZHRoOjkwcHg7aGVpZ2h0OjkwcHg7Ym9yZGVyLXJhZGl1czo1MCU7YmFja2dyb3VuZDp2YXIoLS1hY2NlbnQpO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtmb250LXNpemU6MzZweDtmb250LXdlaWdodDo3MDA7bWFyZ2luOjAgYXV0byAxMnB4O292ZXJmbG93OmhpZGRlbjtib3JkZXI6M3B4IHNvbGlkIHJnYmEoMTI0LDU4LDIzNywuNCl9Ci5wcm9maWxlLWJpZy1hdmF0YXIgaW1ne3dpZHRoOjEwMCU7aGVpZ2h0OjEwMCU7b2JqZWN0LWZpdDpjb3Zlcn0KLnByb2ZpbGUtbmFtZXtmb250LXNpemU6MjJweDtmb250LXdlaWdodDo3MDB9Ci5wcm9maWxlLXVzZXJuYW1le2ZvbnQtc2l6ZToxNHB4O2NvbG9yOnZhcigtLXRleHQyKTttYXJnaW4tdG9wOjRweH0KLnByb2ZpbGUtcHJlbWl1bS1iYWRnZXtkaXNwbGF5OmlubGluZS1mbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6NnB4O2JhY2tncm91bmQ6bGluZWFyLWdyYWRpZW50KDEzNWRlZyxyZ2JhKDEyNCw1OCwyMzcsLjI1KSxyZ2JhKDEwOSwyOCwyMTcsLjIpKTtib3JkZXI6MXB4IHNvbGlkIHJnYmEoMTI0LDU4LDIzNywuNCk7Ym9yZGVyLXJhZGl1czoyMHB4O3BhZGRpbmc6NHB4IDEycHg7Zm9udC1zaXplOjEzcHg7Zm9udC13ZWlnaHQ6NjAwO2NvbG9yOiNhNzhiZmE7bWFyZ2luLXRvcDoxMHB4fQoucHJvZmlsZS1zdGF0c3tkaXNwbGF5OmdyaWQ7Z3JpZC10ZW1wbGF0ZS1jb2x1bW5zOnJlcGVhdCgzLDFmcik7Z2FwOjEycHg7bWFyZ2luLWJvdHRvbToyNHB4fQoucHJvZmlsZS1zdGF0e2JhY2tncm91bmQ6dmFyKC0tYmczKTtib3JkZXItcmFkaXVzOjEwcHg7cGFkZGluZzoxNHB4O3RleHQtYWxpZ246Y2VudGVyfQoucHJvZmlsZS1zdGF0IGgze2ZvbnQtc2l6ZToyMHB4O2ZvbnQtd2VpZ2h0OjcwMDtjb2xvcjp2YXIoLS1hY2NlbnQpfQoucHJvZmlsZS1zdGF0IHB7Zm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dDIpO21hcmdpbi10b3A6NHB4fQoucHJvZmlsZS1zZWN0aW9ue21hcmdpbi1ib3R0b206MjBweH0KLnByb2ZpbGUtc2VjdGlvbiBoM3tmb250LXNpemU6MTNweDtmb250LXdlaWdodDo3MDA7Y29sb3I6dmFyKC0tdGV4dDIpO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouNnB4O21hcmdpbi1ib3R0b206MTBweH0KLnByb2ZpbGUtcm93e2Rpc3BsYXk6ZmxleDtqdXN0aWZ5LWNvbnRlbnQ6c3BhY2UtYmV0d2VlbjthbGlnbi1pdGVtczpjZW50ZXI7cGFkZGluZzoxMnB4O2JhY2tncm91bmQ6dmFyKC0tYmczKTtib3JkZXItcmFkaXVzOjEwcHg7bWFyZ2luLWJvdHRvbTo2cHh9Ci5wcm9maWxlLXJvdyBsYWJlbHtmb250LXNpemU6MTRweDtjb2xvcjp2YXIoLS10ZXh0Mil9Ci5wcm9maWxlLXJvdyBzcGFue2ZvbnQtc2l6ZToxNHB4O2ZvbnQtd2VpZ2h0OjYwMH0KLyog4pSA4pSAIE1PREFMIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCAqLwoubW9kYWwtb3ZlcmxheXtwb3NpdGlvbjpmaXhlZDtpbnNldDowO2JhY2tncm91bmQ6cmdiYSgwLDAsMCwuNik7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyO3otaW5kZXg6NTAwO2JhY2tkcm9wLWZpbHRlcjpibHVyKDRweCl9Ci5tb2RhbHtiYWNrZ3JvdW5kOnZhcigtLWJnMik7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXIpO2JvcmRlci1yYWRpdXM6MjBweDtwYWRkaW5nOjI4cHg7d2lkdGg6MTAwJTttYXgtd2lkdGg6NDQwcHg7Ym94LXNoYWRvdzowIDMwcHggODBweCByZ2JhKDAsMCwwLC41KX0KLm1vZGFsIGgye2ZvbnQtc2l6ZToyMHB4O2ZvbnQtd2VpZ2h0OjcwMDttYXJnaW4tYm90dG9tOjIwcHh9Ci5tb2RhbC1mb290ZXJ7ZGlzcGxheTpmbGV4O2dhcDoxMHB4O21hcmdpbi10b3A6MjBweH0KLmJ0bi1zZWNvbmRhcnl7YmFja2dyb3VuZDp2YXIoLS1iZzMpO2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyKTtjb2xvcjp2YXIoLS10ZXh0KTtib3JkZXItcmFkaXVzOnZhcigtLXJhZGl1cy1zbSk7cGFkZGluZzoxMXB4O2ZvbnQtc2l6ZToxNHB4O2ZvbnQtd2VpZ2h0OjYwMDtjdXJzb3I6cG9pbnRlcjtmbGV4OjE7Zm9udC1mYW1pbHk6aW5oZXJpdDt0cmFuc2l0aW9uOi4yc30KLmJ0bi1zZWNvbmRhcnk6aG92ZXJ7YmFja2dyb3VuZDp2YXIoLS1iZzQpfQouYnRuLWRhbmdlcntiYWNrZ3JvdW5kOnZhcigtLXJlZCk7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOnZhcigtLXJhZGl1cy1zbSk7cGFkZGluZzoxMXB4O2ZvbnQtc2l6ZToxNHB4O2ZvbnQtd2VpZ2h0OjYwMDtjdXJzb3I6cG9pbnRlcjtmbGV4OjE7Zm9udC1mYW1pbHk6aW5oZXJpdDt0cmFuc2l0aW9uOi4yc30KLyog4pSA4pSAIFRPQVNUIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCAqLwojdG9hc3R7cG9zaXRpb246Zml4ZWQ7Ym90dG9tOjI0cHg7bGVmdDo1MCU7dHJhbnNmb3JtOnRyYW5zbGF0ZVgoLTUwJSk7YmFja2dyb3VuZDp2YXIoLS1iZzMpO2JvcmRlcjoxcHggc29saWQgdmFyKC0tYm9yZGVyKTtib3JkZXItcmFkaXVzOjEwcHg7cGFkZGluZzoxMnB4IDIwcHg7Zm9udC1zaXplOjE0cHg7Zm9udC13ZWlnaHQ6NjAwO3otaW5kZXg6OTk5OTt0cmFuc2l0aW9uOi4zcztwb2ludGVyLWV2ZW50czpub25lO29wYWNpdHk6MDtib3gtc2hhZG93OjAgMTBweCA0MHB4IHJnYmEoMCwwLDAsLjQpfQojdG9hc3Quc2hvd3tvcGFjaXR5OjF9CiN0b2FzdC5zdWNjZXNze2JvcmRlci1jb2xvcjp2YXIoLS1ncmVlbik7Y29sb3I6dmFyKC0tZ3JlZW4pfQojdG9hc3QuZXJyb3J7Ym9yZGVyLWNvbG9yOnZhcigtLXJlZCk7Y29sb3I6dmFyKC0tcmVkKX0KLyog4pSA4pSAIE1JU0Mg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAICovCi50eXBpbmctaW5kaWNhdG9ye2ZvbnQtc2l6ZToxMnB4O2NvbG9yOnZhcigtLXRleHQzKTtwYWRkaW5nOjAgMjBweCA4cHg7bWluLWhlaWdodDoyMHB4fQoubm8tY2hhdHtmbGV4OjE7ZGlzcGxheTpmbGV4O2ZsZXgtZGlyZWN0aW9uOmNvbHVtbjthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0Myk7Z2FwOjhweH0KLmRpdmlkZXItZGF0ZXt0ZXh0LWFsaWduOmNlbnRlcjtmb250LXNpemU6MTFweDtjb2xvcjp2YXIoLS10ZXh0Myk7bWFyZ2luOjEycHggMDtwb3NpdGlvbjpyZWxhdGl2ZX0KLmRpdmlkZXItZGF0ZTo6YmVmb3JlLC5kaXZpZGVyLWRhdGU6OmFmdGVye2NvbnRlbnQ6Jyc7cG9zaXRpb246YWJzb2x1dGU7dG9wOjUwJTtoZWlnaHQ6MXB4O2JhY2tncm91bmQ6dmFyKC0tYm9yZGVyKTt3aWR0aDpjYWxjKDUwJSAtIDYwcHgpfQouZGl2aWRlci1kYXRlOjpiZWZvcmV7bGVmdDowfS5kaXZpZGVyLWRhdGU6OmFmdGVye3JpZ2h0OjB9Ci5vbmxpbmUtZG90e3dpZHRoOjhweDtoZWlnaHQ6OHB4O2JhY2tncm91bmQ6dmFyKC0tZ3JlZW4pO2JvcmRlci1yYWRpdXM6NTAlO2Rpc3BsYXk6aW5saW5lLWJsb2NrfQppbWcuYXZhdGFyLWltZ3t3aWR0aDoxMDAlO2hlaWdodDoxMDAlO29iamVjdC1maXQ6Y292ZXI7Ym9yZGVyLXJhZGl1czo1MCV9Ci5wcmVtaXVtLWNyb3duLWJhZGdle2ZvbnQtc2l6ZToxMnB4O21hcmdpbi1sZWZ0OjRweDtjb2xvcjp2YXIoLS1nb2xkKX0KPC9zdHlsZT4KPC9oZWFkPgo8Ym9keT4KCjwhLS0gQVVUSCAtLT4KPGRpdiBpZD0iYXV0aC1zY3JlZW4iPgogIDxkaXYgY2xhc3M9ImF1dGgtYm94Ij4KICAgIDxkaXYgY2xhc3M9ImF1dGgtbG9nbyI+CiAgICAgIDxoMT5PbW5pPC9oMT4KICAgICAgPHA+0JzQtdGB0YHQtdC90LTQttC10YAg0L3QvtCy0L7Qs9C+INC/0L7QutC+0LvQtdC90LjRjyDigKIgdjMuMCBCZXRhPC9wPgogICAgPC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJhdXRoLXRhYnMiPgogICAgICA8ZGl2IGNsYXNzPSJhdXRoLXRhYiBhY3RpdmUiIG9uY2xpY2s9InN3aXRjaEF1dGhUYWIoJ2xvZ2luJykiPtCS0L7QudGC0Lg8L2Rpdj4KICAgICAgPGRpdiBjbGFzcz0iYXV0aC10YWIiIG9uY2xpY2s9InN3aXRjaEF1dGhUYWIoJ3JlZ2lzdGVyJykiPtCg0LXQs9C40YHRgtGA0LDRhtC40Y88L2Rpdj4KICAgIDwvZGl2PgogICAgPGRpdiBpZD0ibG9naW4tZm9ybSI+CiAgICAgIDxkaXYgY2xhc3M9ImZvcm0tZ3JvdXAiPjxsYWJlbD7QmNC80Y8g0L/QvtC70YzQt9C+0LLQsNGC0LXQu9GPPC9sYWJlbD48aW5wdXQgaWQ9ImwtdXNlcm5hbWUiIHR5cGU9InRleHQiIHBsYWNlaG9sZGVyPSJ1c2VybmFtZSIgYXV0b2NvbXBsZXRlPSJ1c2VybmFtZSIvPjwvZGl2PgogICAgICA8ZGl2IGNsYXNzPSJmb3JtLWdyb3VwIj48bGFiZWw+0J/QsNGA0L7Qu9GMPC9sYWJlbD48aW5wdXQgaWQ9ImwtcGFzc3dvcmQiIHR5cGU9InBhc3N3b3JkIiBwbGFjZWhvbGRlcj0i4oCi4oCi4oCi4oCi4oCi4oCi4oCi4oCiIiBhdXRvY29tcGxldGU9ImN1cnJlbnQtcGFzc3dvcmQiLz48L2Rpdj4KICAgICAgPGJ1dHRvbiBjbGFzcz0iYnRuIGJ0bi1wcmltYXJ5IiBvbmNsaWNrPSJkb0xvZ2luKCkiPtCS0L7QudGC0Lg8L2J1dHRvbj4KICAgIDwvZGl2PgogICAgPGRpdiBpZD0icmVnaXN0ZXItZm9ybSIgc3R5bGU9ImRpc3BsYXk6bm9uZSI+CiAgICAgIDxkaXYgY2xhc3M9ImZvcm0tZ3JvdXAiPjxsYWJlbD7QmNC80Y8g0L/QvtC70YzQt9C+0LLQsNGC0LXQu9GPPC9sYWJlbD48aW5wdXQgaWQ9InItdXNlcm5hbWUiIHR5cGU9InRleHQiIHBsYWNlaG9sZGVyPSJ1c2VybmFtZSIgYXV0b2NvbXBsZXRlPSJ1c2VybmFtZSIvPjwvZGl2PgogICAgICA8ZGl2IGNsYXNzPSJmb3JtLWdyb3VwIj48bGFiZWw+0J7RgtC+0LHRgNCw0LbQsNC10LzQvtC1INC40LzRjzwvbGFiZWw+PGlucHV0IGlkPSJyLWRpc3BsYXluYW1lIiB0eXBlPSJ0ZXh0IiBwbGFjZWhvbGRlcj0i0JLQsNGI0LUg0LjQvNGPIi8+PC9kaXY+CiAgICAgIDxkaXYgY2xhc3M9ImZvcm0tZ3JvdXAiPjxsYWJlbD7Qn9Cw0YDQvtC70Yw8L2xhYmVsPjxpbnB1dCBpZD0ici1wYXNzd29yZCIgdHlwZT0icGFzc3dvcmQiIHBsYWNlaG9sZGVyPSLQnNC40L3QuNC80YPQvCA2INGB0LjQvNCy0L7Qu9C+0LIiIGF1dG9jb21wbGV0ZT0ibmV3LXBhc3N3b3JkIi8+PC9kaXY+CiAgICAgIDxidXR0b24gY2xhc3M9ImJ0biBidG4tcHJpbWFyeSIgb25jbGljaz0iZG9SZWdpc3RlcigpIj7QodC+0LfQtNCw0YLRjCDQsNC60LrQsNGD0L3RgjwvYnV0dG9uPgogICAgPC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJhdXRoLWVycm9yIiBpZD0iYXV0aC1lcnJvciI+PC9kaXY+CiAgPC9kaXY+CjwvZGl2PgoKPCEtLSBNQUlOIEFQUCAtLT4KPGRpdiBpZD0iYXBwIj4KICA8IS0tIFJhaWwgLS0+CiAgPGRpdiBjbGFzcz0icmFpbCI+CiAgICA8YnV0dG9uIGNsYXNzPSJyYWlsLWJ0biBhY3RpdmUiIGlkPSJyYWlsLWRtIiBvbmNsaWNrPSJzaG93UGFuZWwoJ2RtJykiIHRpdGxlPSLQodC+0L7QsdGJ0LXQvdC40Y8iPgogICAgICA8c3ZnIGZpbGw9Im5vbmUiIHZpZXdCb3g9IjAgMCAyNCAyNCIgc3Ryb2tlPSJjdXJyZW50Q29sb3IiIHN0cm9rZS13aWR0aD0iMiI+PHBhdGggc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBkPSJNOCAxMmguMDFNMTIgMTJoLjAxTTE2IDEyaC4wMU0yMSAxMmMwIDQuNDE4LTQuMDMgOC05IDhhOS44NjMgOS44NjMgMCAwMS00LjI1NS0uOTQ5TDMgMjBsMS4zOTUtMy43MkMzLjUxMiAxNS4wNDIgMyAxMy41NzQgMyAxMmMwLTQuNDE4IDQuMDMtOCA5LThzOSAzLjU4MiA5IDh6Ii8+PC9zdmc+CiAgICAgIDxzcGFuIGNsYXNzPSJiYWRnZSIgaWQ9InJhaWwtZG0tYmFkZ2UiIHN0eWxlPSJkaXNwbGF5Om5vbmUiPjA8L3NwYW4+CiAgICA8L2J1dHRvbj4KICAgIDxidXR0b24gY2xhc3M9InJhaWwtYnRuIiBpZD0icmFpbC1zZXJ2ZXJzIiBvbmNsaWNrPSJzaG93UGFuZWwoJ3NlcnZlcnMnKSIgdGl0bGU9ItCh0LXRgNCy0LXRgNGLIj4KICAgICAgPHN2ZyBmaWxsPSJub25lIiB2aWV3Qm94PSIwIDAgMjQgMjQiIHN0cm9rZT0iY3VycmVudENvbG9yIiBzdHJva2Utd2lkdGg9IjIiPjxwYXRoIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIgZD0iTTUgMTJoMTRNNSAxMmEyIDIgMCAwMS0yLTJWNmEyIDIgMCAwMTItMmgxNGEyIDIgMCAwMTIgMnY0YTIgMiAwIDAxLTIgMk01IDEyYTIgMiAwIDAwLTIgMnY0YTIgMiAwIDAwMiAyaDE0YTIgMiAwIDAwMi0ydi00YTIgMiAwIDAwLTItMiIvPjwvc3ZnPgogICAgPC9idXR0b24+CiAgICA8ZGl2IGNsYXNzPSJyYWlsLXNlcCI+PC9kaXY+CiAgICA8YnV0dG9uIGNsYXNzPSJyYWlsLWJ0biIgaWQ9InJhaWwtc2hvcCIgb25jbGljaz0ic2hvd1BhbmVsKCdzaG9wJykiIHRpdGxlPSLQnNCw0LPQsNC30LjQvSI+CiAgICAgIDxzdmcgZmlsbD0ibm9uZSIgdmlld0JveD0iMCAwIDI0IDI0IiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIj48cGF0aCBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGQ9Ik0xNiAxMVY3YTQgNCAwIDAwLTggMHY0TTUgOWgxNGwxIDEySDRMNSA5eiIvPjwvc3ZnPgogICAgPC9idXR0b24+CiAgICA8YnV0dG9uIGNsYXNzPSJyYWlsLWJ0biIgaWQ9InJhaWwtcHJvZmlsZSIgb25jbGljaz0ic2hvd1BhbmVsKCdwcm9maWxlJykiIHRpdGxlPSLQn9GA0L7RhNC40LvRjCIgc3R5bGU9Im1hcmdpbi10b3A6YXV0byI+CiAgICAgIDxzdmcgZmlsbD0ibm9uZSIgdmlld0JveD0iMCAwIDI0IDI0IiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIj48cGF0aCBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGQ9Ik0xNiA3YTQgNCAwIDExLTggMCA0IDQgMCAwMTggMHpNMTIgMTRhNyA3IDAgMDAtNyA3aDE0YTcgNyAwIDAwLTctN3oiLz48L3N2Zz4KICAgIDwvYnV0dG9uPgogIDwvZGl2PgoKICA8IS0tIERNIFBhbmVsIC0tPgogIDxkaXYgY2xhc3M9InBhbmVsIGFjdGl2ZSIgaWQ9InBhbmVsLWRtIj4KICAgIDxkaXYgY2xhc3M9ImRtLXBhbmVsIj4KICAgICAgPGRpdiBjbGFzcz0iY29udi1zaWRlYmFyIj4KICAgICAgICA8ZGl2IGNsYXNzPSJzaWRlYmFyLWhlYWRlciI+CiAgICAgICAgICA8aDI+0KHQvtC+0LHRidC10L3QuNGPPC9oMj4KICAgICAgICAgIDxkaXYgY2xhc3M9InNlYXJjaC1ib3giPjxpbnB1dCB0eXBlPSJ0ZXh0IiBwbGFjZWhvbGRlcj0i0J/QvtC40YHQui4uLiIgaWQ9ImNvbnYtc2VhcmNoIiBvbmlucHV0PSJmaWx0ZXJDb252cyh0aGlzLnZhbHVlKSIvPjwvZGl2PgogICAgICAgIDwvZGl2PgogICAgICAgIDxkaXYgY2xhc3M9ImNvbnYtbGlzdCIgaWQ9ImNvbnYtbGlzdCI+CiAgICAgICAgICA8ZGl2IHN0eWxlPSJwYWRkaW5nOjIwcHg7dGV4dC1hbGlnbjpjZW50ZXI7Y29sb3I6dmFyKC0tdGV4dDMpO2ZvbnQtc2l6ZToxM3B4Ij7Ql9Cw0LPRgNGD0LfQutCwLi4uPC9kaXY+CiAgICAgICAgPC9kaXY+CiAgICAgIDwvZGl2PgogICAgICA8ZGl2IGNsYXNzPSJjaGF0LWFyZWEiIGlkPSJkbS1jaGF0LWFyZWEiPgogICAgICAgIDxkaXYgY2xhc3M9Im5vLWNoYXQiPgogICAgICAgICAgPHN2ZyBmaWxsPSJub25lIiB2aWV3Qm94PSIwIDAgMjQgMjQiIHN0cm9rZT0iY3VycmVudENvbG9yIiBzdHJva2Utd2lkdGg9IjEuNSI+PHBhdGggc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBkPSJNOCAxMmguMDFNMTIgMTJoLjAxTTE2IDEyaC4wMU0yMSAxMmMwIDQuNDE4LTQuMDMgOC05IDhhOS44NjMgOS44NjMgMCAwMS00LjI1NS0uOTQ5TDMgMjBsMS4zOTUtMy43MkMzLjUxMiAxNS4wNDIgMyAxMy41NzQgMyAxMmMwLTQuNDE4IDQuMDMtOCA5LThzOSAzLjU4MiA5IDh6Ii8+PC9zdmc+CiAgICAgICAgICA8cD7QktGL0LHQtdGA0LjRgtC1INC00LjQsNC70L7QszwvcD4KICAgICAgICA8L2Rpdj4KICAgICAgPC9kaXY+CiAgICA8L2Rpdj4KICA8L2Rpdj4KCiAgPCEtLSBTZXJ2ZXJzIFBhbmVsIC0tPgogIDxkaXYgY2xhc3M9InBhbmVsIiBpZD0icGFuZWwtc2VydmVycyI+CiAgICA8ZGl2IGNsYXNzPSJzZXJ2ZXJzLXBhbmVsIj4KICAgICAgPGRpdiBjbGFzcz0ic2VydmVyLWxpc3Qtc2lkZWJhciI+CiAgICAgICAgPGRpdiBjbGFzcz0ic2lkZWJhci1oZWFkZXIiPgogICAgICAgICAgPGgyPtCh0LXRgNCy0LXRgNGLPC9oMj4KICAgICAgICAgIDxidXR0b24gY2xhc3M9ImNyZWF0ZS1zZXJ2ZXItYnRuIiBvbmNsaWNrPSJvcGVuQ3JlYXRlU2VydmVyKCkiPisg0KHQvtC30LTQsNGC0Ywg0YHQtdGA0LLQtdGAPC9idXR0b24+CiAgICAgICAgPC9kaXY+CiAgICAgICAgPGRpdiBjbGFzcz0iY29udi1saXN0IiBpZD0ic2VydmVyLWxpc3QiPgogICAgICAgICAgPGRpdiBzdHlsZT0icGFkZGluZzoyMHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXRleHQzKTtmb250LXNpemU6MTNweCI+0JfQsNCz0YDRg9C30LrQsC4uLjwvZGl2PgogICAgICAgIDwvZGl2PgogICAgICAgIDxkaXYgc3R5bGU9InBhZGRpbmc6MTJweCAxNHB4O2JvcmRlci10b3A6MXB4IHNvbGlkIHZhcigtLWJvcmRlcikiPgogICAgICAgICAgPGJ1dHRvbiBjbGFzcz0iY3JlYXRlLXNlcnZlci1idG4iIG9uY2xpY2s9Im9wZW5Kb2luU2VydmVyKCkiPvCflJcg0JLQvtC50YLQuCDQv9C+INC60L7QtNGDPC9idXR0b24+CiAgICAgICAgPC9kaXY+CiAgICAgIDwvZGl2PgogICAgICA8ZGl2IGNsYXNzPSJzZXJ2ZXItY2hhbm5lbC1zaWRlYmFyIiBpZD0ic2VydmVyLWNoYW5uZWwtc2lkZWJhciI+CiAgICAgICAgPGRpdiBjbGFzcz0ic2lkZWJhci1oZWFkZXIiPgogICAgICAgICAgPGRpdiBzdHlsZT0iZm9udC1zaXplOjE1cHg7Zm9udC13ZWlnaHQ6NzAwO2NvbG9yOnZhcigtLXRleHQzKSI+0JLRi9Cx0LXRgNC40YLQtSDRgdC10YDQstC10YA8L2Rpdj4KICAgICAgICA8L2Rpdj4KICAgICAgPC9kaXY+CiAgICAgIDxkaXYgY2xhc3M9ImNoYW5uZWwtYXJlYSIgaWQ9ImNoYW5uZWwtY2hhdC1hcmVhIj4KICAgICAgICA8ZGl2IGNsYXNzPSJuby1jaGF0Ij4KICAgICAgICAgIDxzdmcgZmlsbD0ibm9uZSIgdmlld0JveD0iMCAwIDI0IDI0IiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIxLjUiPjxwYXRoIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIgZD0iTTUgMTJoMTRNNSAxMmEyIDIgMCAwMS0yLTJWNmEyIDIgMCAwMTItMmgxNGEyIDIgMCAwMTIgMnY0YTIgMiAwIDAxLTIgMk01IDEyYTIgMiAwIDAwLTIgMnY0YTIgMiAwIDAwMiAyaDE0YTIgMiAwIDAwMi0ydi00YTIgMiAwIDAwLTItMiIvPjwvc3ZnPgogICAgICAgICAgPHA+0JLRi9Cx0LXRgNC40YLQtSDQutCw0L3QsNC7PC9wPgogICAgICAgIDwvZGl2PgogICAgICA8L2Rpdj4KICAgIDwvZGl2PgogIDwvZGl2PgoKICA8IS0tIFNob3AgUGFuZWwgLS0+CiAgPGRpdiBjbGFzcz0icGFuZWwiIGlkPSJwYW5lbC1zaG9wIj4KICAgIDxkaXYgY2xhc3M9InNob3AtcGFuZWwiPgogICAgICA8aDE+8J+bje+4jyDQnNCw0LPQsNC30LjQvTwvaDE+CiAgICAgIDxwIGNsYXNzPSJzdWJ0aXRsZSI+0J/RgNC10LzQuNGD0LwsINC80L7QvdC10YLRiyDQuCDQv9C+0LTQsNGA0LrQuCDQtNC70Y8g0LTRgNGD0LfQtdC5PC9wPgogICAgICA8ZGl2IGNsYXNzPSJzaG9wLXRhYnMiPgogICAgICAgIDxkaXYgY2xhc3M9InNob3AtdGFiIGFjdGl2ZSIgb25jbGljaz0ic3dpdGNoU2hvcFRhYigncHJlbWl1bScpIj7wn5GRINCf0YDQtdC80LjRg9C8PC9kaXY+CiAgICAgICAgPGRpdiBjbGFzcz0ic2hvcC10YWIiIG9uY2xpY2s9InN3aXRjaFNob3BUYWIoJ2NvaW5zJykiPvCfqpkg0JzQvtC90LXRgtGLPC9kaXY+CiAgICAgICAgPGRpdiBjbGFzcz0ic2hvcC10YWIiIG9uY2xpY2s9InN3aXRjaFNob3BUYWIoJ2dpZnRzJykiPvCfjoEg0J/QvtC00LDRgNC60Lg8L2Rpdj4KICAgICAgPC9kaXY+CiAgICAgIDxkaXYgaWQ9InNob3AtY29udGVudCI+PC9kaXY+CiAgICA8L2Rpdj4KICA8L2Rpdj4KCiAgPCEtLSBQcm9maWxlIFBhbmVsIC0tPgogIDxkaXYgY2xhc3M9InBhbmVsIiBpZD0icGFuZWwtcHJvZmlsZSI+CiAgICA8ZGl2IGNsYXNzPSJwcm9maWxlLXBhbmVsIj4KICAgICAgPGRpdiBjbGFzcz0icHJvZmlsZS1jYXJkIiBpZD0icHJvZmlsZS1jYXJkIj4KICAgICAgICA8ZGl2IHN0eWxlPSJ0ZXh0LWFsaWduOmNlbnRlcjtjb2xvcjp2YXIoLS10ZXh0MykiPtCX0LDQs9GA0YPQt9C60LAuLi48L2Rpdj4KICAgICAgPC9kaXY+CiAgICA8L2Rpdj4KICA8L2Rpdj4KPC9kaXY+Cgo8ZGl2IGlkPSJ0b2FzdCI+PC9kaXY+Cgo8c2NyaXB0PgovLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZAKLy8gQ09ORklHCi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkApjb25zdCBBUEkgPSAnJzsgIC8vIHNhbWUgb3JpZ2luCmNvbnN0IFdTX1VSTCA9IChsb2NhdGlvbi5wcm90b2NvbCA9PT0gJ2h0dHBzOicgPyAnd3NzOicgOiAnd3M6JykgKyAnLy8nICsgbG9jYXRpb24uaG9zdCArICcvd3MnOwpjb25zdCBDTElFTlRfVkVSU0lPTiA9ICd3ZWInOwoKLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQCi8vIFNUQVRFCi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkApsZXQgdG9rZW4gPSBsb2NhbFN0b3JhZ2UuZ2V0SXRlbSgnb21uaV90b2tlbicpOwpsZXQgbWUgPSBudWxsOwpsZXQgd3MgPSBudWxsOwpsZXQgYWN0aXZlQ29udklkID0gbnVsbDsKbGV0IGFjdGl2ZUNoYW5uZWxJZCA9IG51bGw7CmxldCBhY3RpdmVTZXJ2ZXJJZCA9IG51bGw7CmxldCBjb252ZXJzYXRpb25zID0gW107CmxldCBjb252TWVzc2FnZXMgPSB7fTsKbGV0IHNlcnZlckxpc3QgPSBbXTsKbGV0IGNoYW5uZWxNZXNzYWdlcyA9IHt9OwpsZXQgZ2lmdHNDYXRhbG9nID0gW107CmxldCBjb2luUGFja2FnZXMgPSBbXTsKbGV0IHNob3BUYWIgPSAncHJlbWl1bSc7CmxldCB0eXBpbmdUaW1lciA9IG51bGw7CgovLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZAKLy8gQVBJIEhFTFBFUgovLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZAKYXN5bmMgZnVuY3Rpb24gYXBpKG1ldGhvZCwgcGF0aCwgYm9keSkgewogIGNvbnN0IGhlYWRlcnMgPSB7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsICd4LWFwcC12ZXJzaW9uJzogQ0xJRU5UX1ZFUlNJT04gfTsKICBpZiAodG9rZW4pIGhlYWRlcnNbJ0F1dGhvcml6YXRpb24nXSA9ICdCZWFyZXIgJyArIHRva2VuOwogIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKEFQSSArIHBhdGgsIHsKICAgIG1ldGhvZCwKICAgIGhlYWRlcnMsCiAgICBib2R5OiBib2R5ID8gSlNPTi5zdHJpbmdpZnkoYm9keSkgOiB1bmRlZmluZWQsCiAgfSk7CiAgY29uc3QgZGF0YSA9IGF3YWl0IHJlcy5qc29uKCkuY2F0Y2goKCkgPT4gKHt9KSk7CiAgaWYgKCFyZXMub2spIHRocm93IG5ldyBFcnJvcihkYXRhLmVycm9yIHx8IGRhdGEubWVzc2FnZSB8fCAn0J7RiNC40LHQutCwINC30LDQv9GA0L7RgdCwJyk7CiAgcmV0dXJuIGRhdGE7Cn0KCi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkAovLyBUT0FTVAovLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZAKZnVuY3Rpb24gc2hvd1RvYXN0KG1zZywgdHlwZSA9ICdpbmZvJykgewogIGNvbnN0IHQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgndG9hc3QnKTsKICB0LnRleHRDb250ZW50ID0gbXNnOwogIHQuY2xhc3NOYW1lID0gJ3Nob3cgJyArIHR5cGU7CiAgY2xlYXJUaW1lb3V0KHQuX3RpbWVyKTsKICB0Ll90aW1lciA9IHNldFRpbWVvdXQoKCkgPT4geyB0LmNsYXNzTmFtZSA9ICcnOyB9LCAzMDAwKTsKfQoKLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQCi8vIEFVVEgKLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQCmZ1bmN0aW9uIHN3aXRjaEF1dGhUYWIodGFiKSB7CiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2F1dGgtZXJyb3InKS50ZXh0Q29udGVudCA9ICcnOwogIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJy5hdXRoLXRhYicpLmZvckVhY2goKGVsLCBpKSA9PiB7CiAgICBlbC5jbGFzc0xpc3QudG9nZ2xlKCdhY3RpdmUnLCAoaSA9PT0gMCkgPT09ICh0YWIgPT09ICdsb2dpbicpKTsKICB9KTsKICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbG9naW4tZm9ybScpLnN0eWxlLmRpc3BsYXkgPSB0YWIgPT09ICdsb2dpbicgPyAnJyA6ICdub25lJzsKICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmVnaXN0ZXItZm9ybScpLnN0eWxlLmRpc3BsYXkgPSB0YWIgPT09ICdyZWdpc3RlcicgPyAnJyA6ICdub25lJzsKfQoKYXN5bmMgZnVuY3Rpb24gZG9Mb2dpbigpIHsKICBjb25zdCB1c2VybmFtZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdsLXVzZXJuYW1lJykudmFsdWUudHJpbSgpOwogIGNvbnN0IHBhc3N3b3JkID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2wtcGFzc3dvcmQnKS52YWx1ZTsKICBpZiAoIXVzZXJuYW1lIHx8ICFwYXNzd29yZCkgcmV0dXJuOwogIHRyeSB7CiAgICBjb25zdCByZXMgPSBhd2FpdCBhcGkoJ1BPU1QnLCAnL2FwaS9hdXRoL2xvZ2luJywgeyB1c2VybmFtZSwgcGFzc3dvcmQgfSk7CiAgICB0b2tlbiA9IHJlcy50b2tlbjsKICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKCdvbW5pX3Rva2VuJywgdG9rZW4pOwogICAgbWUgPSByZXMudXNlcjsKICAgIGF3YWl0IHN0YXJ0QXBwKCk7CiAgfSBjYXRjaCAoZSkgewogICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2F1dGgtZXJyb3InKS50ZXh0Q29udGVudCA9IGUubWVzc2FnZTsKICB9Cn0KCmFzeW5jIGZ1bmN0aW9uIGRvUmVnaXN0ZXIoKSB7CiAgY29uc3QgdXNlcm5hbWUgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnci11c2VybmFtZScpLnZhbHVlLnRyaW0oKTsKICBjb25zdCBkaXNwbGF5TmFtZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyLWRpc3BsYXluYW1lJykudmFsdWUudHJpbSgpOwogIGNvbnN0IHBhc3N3b3JkID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3ItcGFzc3dvcmQnKS52YWx1ZTsKICBpZiAoIXVzZXJuYW1lIHx8ICFwYXNzd29yZCkgcmV0dXJuOwogIHRyeSB7CiAgICBjb25zdCByZXMgPSBhd2FpdCBhcGkoJ1BPU1QnLCAnL2FwaS9hdXRoL3JlZ2lzdGVyJywgeyB1c2VybmFtZSwgZGlzcGxheU5hbWU6IGRpc3BsYXlOYW1lIHx8IHVzZXJuYW1lLCBwYXNzd29yZCB9KTsKICAgIHRva2VuID0gcmVzLnRva2VuOwogICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oJ29tbmlfdG9rZW4nLCB0b2tlbik7CiAgICBtZSA9IHJlcy51c2VyOwogICAgYXdhaXQgc3RhcnRBcHAoKTsKICB9IGNhdGNoIChlKSB7CiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYXV0aC1lcnJvcicpLnRleHRDb250ZW50ID0gZS5tZXNzYWdlOwogIH0KfQoKZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2wtcGFzc3dvcmQnKS5hZGRFdmVudExpc3RlbmVyKCdrZXlkb3duJywgZSA9PiB7IGlmIChlLmtleSA9PT0gJ0VudGVyJykgZG9Mb2dpbigpOyB9KTsKZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3ItcGFzc3dvcmQnKS5hZGRFdmVudExpc3RlbmVyKCdrZXlkb3duJywgZSA9PiB7IGlmIChlLmtleSA9PT0gJ0VudGVyJykgZG9SZWdpc3RlcigpOyB9KTsKCi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkAovLyBTVEFSVFVQCi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkAphc3luYyBmdW5jdGlvbiBzdGFydEFwcCgpIHsKICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYXV0aC1zY3JlZW4nKS5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnOwogIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdhcHAnKS5zdHlsZS5kaXNwbGF5ID0gJ2ZsZXgnOwoKICBpZiAoIW1lKSB7CiAgICB0cnkgeyBtZSA9IGF3YWl0IGFwaSgnR0VUJywgJy9hcGkvYXV0aC9tZScpOyB9IGNhdGNoIHsgbG9nb3V0KCk7IHJldHVybjsgfQogIH0KCiAgY29ubmVjdFdTKCk7CiAgbG9hZENvbnZlcnNhdGlvbnMoKTsKICBsb2FkU2VydmVycygpOwogIHJlbmRlclByb2ZpbGUoKTsKICBsb2FkR2lmdHNDYXRhbG9nKCk7CiAgbG9hZENvaW5QYWNrYWdlcygpOwogIHJlbmRlclNob3AoKTsKfQoKZnVuY3Rpb24gbG9nb3V0KCkgewogIGxvY2FsU3RvcmFnZS5yZW1vdmVJdGVtKCdvbW5pX3Rva2VuJyk7CiAgbG9jYXRpb24ucmVsb2FkKCk7Cn0KCi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkAovLyBXRUJTT0NLRVQKLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQCmZ1bmN0aW9uIGNvbm5lY3RXUygpIHsKICBpZiAod3MpIHsgdHJ5IHsgd3MuY2xvc2UoKTsgfSBjYXRjaCB7fSB9CiAgd3MgPSBuZXcgV2ViU29ja2V0KFdTX1VSTCArICc/dG9rZW49JyArIGVuY29kZVVSSUNvbXBvbmVudCh0b2tlbikgKyAnJnZlcnNpb249JyArIENMSUVOVF9WRVJTSU9OKTsKICB3cy5hZGRFdmVudExpc3RlbmVyKCdtZXNzYWdlJywgZSA9PiB7CiAgICB0cnkgeyBoYW5kbGVXc0V2ZW50KEpTT04ucGFyc2UoZS5kYXRhKSk7IH0gY2F0Y2gge30KICB9KTsKICB3cy5hZGRFdmVudExpc3RlbmVyKCdjbG9zZScsICgpID0+IHsKICAgIHNldFRpbWVvdXQoY29ubmVjdFdTLCAzMDAwKTsKICB9KTsKfQoKZnVuY3Rpb24gaGFuZGxlV3NFdmVudChldikgewogIGlmIChldi50eXBlID09PSAnbmV3X21lc3NhZ2UnKSB7CiAgICBjb25zdCBtc2cgPSBldi5tZXNzYWdlOwogICAgY29uc3QgY2lkID0gbXNnLmNvbnZlcnNhdGlvbklkOwogICAgaWYgKCFjb252TWVzc2FnZXNbY2lkXSkgY29udk1lc3NhZ2VzW2NpZF0gPSBbXTsKICAgIGNvbnZNZXNzYWdlc1tjaWRdLnB1c2gobXNnKTsKICAgIGlmIChjaWQgPT09IGFjdGl2ZUNvbnZJZCkgYXBwZW5kTWVzc2FnZVRvRG0obXNnKTsKICAgIHVwZGF0ZUNvbnZQcmV2aWV3KG1zZyk7CiAgICBsb2FkQ29udmVyc2F0aW9ucygpOwogIH0KICBpZiAoZXYudHlwZSA9PT0gJ2NoYW5uZWxfbWVzc2FnZScpIHsKICAgIGNvbnN0IG1zZyA9IGV2Lm1lc3NhZ2U7CiAgICBjb25zdCBjaWQgPSBtc2cuY2hhbm5lbElkOwogICAgaWYgKCFjaGFubmVsTWVzc2FnZXNbY2lkXSkgY2hhbm5lbE1lc3NhZ2VzW2NpZF0gPSBbXTsKICAgIGNoYW5uZWxNZXNzYWdlc1tjaWRdLnB1c2gobXNnKTsKICAgIGlmIChjaWQgPT09IGFjdGl2ZUNoYW5uZWxJZCkgYXBwZW5kTWVzc2FnZVRvQ2hhbm5lbChtc2cpOwogIH0KICBpZiAoZXYudHlwZSA9PT0gJ3R5cGluZycpIHsKICAgIGlmIChldi5jb252ZXJzYXRpb25JZCA9PT0gYWN0aXZlQ29udklkICYmIGV2LnVzZXJJZCAhPT0gbWUuaWQpIHsKICAgICAgY29uc3QgdGkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZG0tdHlwaW5nJyk7CiAgICAgIGlmICh0aSkgeyB0aS50ZXh0Q29udGVudCA9IGV2LnVzZXJuYW1lICsgJyDQv9C10YfQsNGC0LDQtdGCLi4uJzsgY2xlYXJUaW1lb3V0KHRpLl90KTsgdGkuX3QgPSBzZXRUaW1lb3V0KCgpID0+IHsgdGkudGV4dENvbnRlbnQgPSAnJzsgfSwgMzAwMCk7IH0KICAgIH0KICB9CiAgaWYgKGV2LnR5cGUgPT09ICdjb2luc19hZGRlZCcpIHsKICAgIG1lLmNvaW5zID0gZXYuYmFsYW5jZTsKICAgIHNob3dUb2FzdCgn8J+qmSArJyArIGV2LmNvaW5zICsgJyDQvNC+0L3QtdGCIScsICdzdWNjZXNzJyk7CiAgICByZW5kZXJQcm9maWxlKCk7CiAgfQogIGlmIChldi50eXBlID09PSAnZ2lmdF9yZWNlaXZlZCcpIHsKICAgIHNob3dUb2FzdCgn8J+OgSDQn9C+0LvRg9GH0LXQvSDQv9C+0LTQsNGA0L7QujogJyArIGV2LmdpZnQuZ2lmdE5hbWUgKyAnIScsICdzdWNjZXNzJyk7CiAgfQp9CgovLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZAKLy8gUEFORUwgU1dJVENISU5HCi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkApmdW5jdGlvbiBzaG93UGFuZWwoaWQpIHsKICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCcucGFuZWwnKS5mb3JFYWNoKHAgPT4gcC5jbGFzc0xpc3QucmVtb3ZlKCdhY3RpdmUnKSk7CiAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnLnJhaWwtYnRuJykuZm9yRWFjaChiID0+IGIuY2xhc3NMaXN0LnJlbW92ZSgnYWN0aXZlJykpOwogIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdwYW5lbC0nICsgaWQpLmNsYXNzTGlzdC5hZGQoJ2FjdGl2ZScpOwogIGNvbnN0IHJiID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3JhaWwtJyArIGlkKTsKICBpZiAocmIpIHJiLmNsYXNzTGlzdC5hZGQoJ2FjdGl2ZScpOwogIGlmIChpZCA9PT0gJ3Nob3AnKSByZW5kZXJTaG9wKCk7CiAgaWYgKGlkID09PSAncHJvZmlsZScpIHJlbmRlclByb2ZpbGUoKTsKICBpZiAoaWQgPT09ICdzZXJ2ZXJzJykgbG9hZFNlcnZlcnMoKTsKfQoKLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQCi8vIENPTlZFUlNBVElPTlMgLyBETQovLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZAKYXN5bmMgZnVuY3Rpb24gbG9hZENvbnZlcnNhdGlvbnMoKSB7CiAgdHJ5IHsKICAgIGNvbnZlcnNhdGlvbnMgPSBhd2FpdCBhcGkoJ0dFVCcsICcvYXBpL2NvbnZlcnNhdGlvbnMnKTsKICAgIHJlbmRlckNvbnZMaXN0KGNvbnZlcnNhdGlvbnMpOwogIH0gY2F0Y2gge30KfQoKZnVuY3Rpb24gZmlsdGVyQ29udnMocSkgewogIGNvbnN0IGZpbHRlcmVkID0gcSA/IGNvbnZlcnNhdGlvbnMuZmlsdGVyKGMgPT4gewogICAgY29uc3QgbmFtZSA9IGMubmFtZSB8fCAoYy5tZW1iZXJzIHx8IFtdKS5maW5kKG0gPT4gbS5pZCAhPT0gbWUuaWQpPy5kaXNwbGF5TmFtZSB8fCAnJzsKICAgIHJldHVybiBuYW1lLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMocS50b0xvd2VyQ2FzZSgpKTsKICB9KSA6IGNvbnZlcnNhdGlvbnM7CiAgcmVuZGVyQ29udkxpc3QoZmlsdGVyZWQpOwp9CgpmdW5jdGlvbiByZW5kZXJDb252TGlzdChsaXN0KSB7CiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY29udi1saXN0Jyk7CiAgaWYgKCFsaXN0Lmxlbmd0aCkgeyBlbC5pbm5lckhUTUwgPSAnPGRpdiBzdHlsZT0icGFkZGluZzoyMHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXRleHQzKTtmb250LXNpemU6MTNweCI+0J3QtdGCINC00LjQsNC70L7Qs9C+0LI8L2Rpdj4nOyByZXR1cm47IH0KICBlbC5pbm5lckhUTUwgPSBsaXN0Lm1hcChjID0+IHsKICAgIGNvbnN0IG90aGVyID0gIWMuaXNHcm91cCA/IChjLm1lbWJlcnMgfHwgW10pLmZpbmQobSA9PiBtLmlkICE9PSBtZS5pZCkgOiBudWxsOwogICAgY29uc3QgbmFtZSA9IGMubmFtZSB8fCBvdGhlcj8uZGlzcGxheU5hbWUgfHwgJ9CU0LjQsNC70L7Qsyc7CiAgICBjb25zdCBpbml0aWFscyA9IG5hbWUuc2xpY2UoMCwgMikudG9VcHBlckNhc2UoKTsKICAgIGNvbnN0IGF2YXRhclVybCA9IGMuYXZhdGFyID8gKGMuYXZhdGFyLnN0YXJ0c1dpdGgoJ2h0dHAnKSA/IGMuYXZhdGFyIDogQVBJICsgYy5hdmF0YXIpIDogKG90aGVyPy5hdmF0YXIgPyAob3RoZXIuYXZhdGFyLnN0YXJ0c1dpdGgoJ2h0dHAnKSA/IG90aGVyLmF2YXRhciA6IEFQSSArIG90aGVyLmF2YXRhcikgOiBudWxsKTsKICAgIGNvbnN0IGF2YXRhckh0bWwgPSBhdmF0YXJVcmwgPyBgPGltZyBzcmM9IiR7YXZhdGFyVXJsfSIgc3R5bGU9IndpZHRoOjEwMCU7aGVpZ2h0OjEwMCU7b2JqZWN0LWZpdDpjb3Zlcjtib3JkZXItcmFkaXVzOjUwJSI+YCA6IGluaXRpYWxzOwogICAgY29uc3QgbGFzdE1zZyA9IGMubGFzdE1lc3NhZ2U7CiAgICBjb25zdCBwcmV2aWV3ID0gbGFzdE1zZyA/IChsYXN0TXNnLnR5cGUgPT09ICdnaWZ0JyA/ICfwn46BINCf0L7QtNCw0YDQvtC6JyA6IChsYXN0TXNnLmNvbnRlbnQgfHwgJycpLnNsaWNlKDAsIDQwKSkgOiAnJzsKICAgIGNvbnN0IHRpbWUgPSBsYXN0TXNnID8gZm9ybWF0VGltZShsYXN0TXNnLmNyZWF0ZWRBdCkgOiAnJzsKICAgIGNvbnN0IGFjdGl2ZSA9IGMuaWQgPT09IGFjdGl2ZUNvbnZJZCA/ICdhY3RpdmUnIDogJyc7CiAgICBjb25zdCBpc1ByZW0gPSBvdGhlcj8uaXNQcmVtaXVtOwogICAgcmV0dXJuIGA8ZGl2IGNsYXNzPSJjb252LWl0ZW0gJHthY3RpdmV9IiBvbmNsaWNrPSJvcGVuQ29udignJHtjLmlkfScpIj4KICAgICAgPGRpdiBjbGFzcz0iY29udi1hdmF0YXIiPiR7YXZhdGFySHRtbH08L2Rpdj4KICAgICAgPGRpdiBjbGFzcz0iY29udi1pbmZvIj4KICAgICAgICA8ZGl2IGNsYXNzPSJjb252LW5hbWUiPiR7ZXNjSHRtbChuYW1lKX0ke2lzUHJlbSA/ICc8c3BhbiBjbGFzcz0icHJlbWl1bS1jcm93bi1iYWRnZSI+8J+RkTwvc3Bhbj4nIDogJyd9PC9kaXY+CiAgICAgICAgPGRpdiBjbGFzcz0iY29udi1wcmV2aWV3Ij4ke2VzY0h0bWwocHJldmlldyl9PC9kaXY+CiAgICAgIDwvZGl2PgogICAgICA8ZGl2IGNsYXNzPSJjb252LW1ldGEiPgogICAgICAgIDxzcGFuIGNsYXNzPSJjb252LXRpbWUiPiR7dGltZX08L3NwYW4+CiAgICAgIDwvZGl2PgogICAgPC9kaXY+YDsKICB9KS5qb2luKCcnKTsKfQoKYXN5bmMgZnVuY3Rpb24gb3BlbkNvbnYoaWQpIHsKICBhY3RpdmVDb252SWQgPSBpZDsKICByZW5kZXJDb252TGlzdChjb252ZXJzYXRpb25zKTsKICBjb25zdCBjb252ID0gY29udmVyc2F0aW9ucy5maW5kKGMgPT4gYy5pZCA9PT0gaWQpOwogIGNvbnN0IG90aGVyID0gY29udiAmJiAhY29udi5pc0dyb3VwID8gKGNvbnYubWVtYmVycyB8fCBbXSkuZmluZChtID0+IG0uaWQgIT09IG1lLmlkKSA6IG51bGw7CiAgY29uc3QgbmFtZSA9IGNvbnY/Lm5hbWUgfHwgb3RoZXI/LmRpc3BsYXlOYW1lIHx8ICfQlNC40LDQu9C+0LMnOwoKICAvLyBMb2FkIG1lc3NhZ2VzCiAgdHJ5IHsKICAgIGNvbnN0IG1zZ3MgPSBhd2FpdCBhcGkoJ0dFVCcsIGAvYXBpL2NvbnZlcnNhdGlvbnMvJHtpZH0vbWVzc2FnZXM/bGltaXQ9NTBgKTsKICAgIGNvbnZNZXNzYWdlc1tpZF0gPSBtc2dzOwogIH0gY2F0Y2ggeyBjb252TWVzc2FnZXNbaWRdID0gW107IH0KCiAgcmVuZGVyRG1DaGF0KGlkLCBuYW1lLCBvdGhlcik7CiAgaWYgKHdzICYmIHdzLnJlYWR5U3RhdGUgPT09IDEpIHsKICAgIHdzLnNlbmQoSlNPTi5zdHJpbmdpZnkoeyB0eXBlOiAnc3Vic2NyaWJlJywgY29udmVyc2F0aW9uSWQ6IGlkIH0pKTsKICB9Cn0KCmZ1bmN0aW9uIHJlbmRlckRtQ2hhdChjb252SWQsIG5hbWUsIG90aGVyKSB7CiAgY29uc3QgbXNncyA9IGNvbnZNZXNzYWdlc1tjb252SWRdIHx8IFtdOwogIGNvbnN0IGF2YXRhclVybCA9IG90aGVyPy5hdmF0YXIgPyAob3RoZXIuYXZhdGFyLnN0YXJ0c1dpdGgoJ2h0dHAnKSA/IG90aGVyLmF2YXRhciA6IEFQSSArIG90aGVyLmF2YXRhcikgOiBudWxsOwogIGNvbnN0IGF2YXRhckh0bWwgPSBhdmF0YXJVcmwgPyBgPGltZyBzcmM9IiR7YXZhdGFyVXJsfSIgc3R5bGU9IndpZHRoOjEwMCU7aGVpZ2h0OjEwMCU7b2JqZWN0LWZpdDpjb3Zlcjtib3JkZXItcmFkaXVzOjUwJSI+YCA6IG5hbWUuc2xpY2UoMCwgMikudG9VcHBlckNhc2UoKTsKCiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RtLWNoYXQtYXJlYScpLmlubmVySFRNTCA9IGAKICAgIDxkaXYgY2xhc3M9ImNoYXQtaGVhZGVyIj4KICAgICAgPGRpdiBjbGFzcz0iY2hhdC1oZWFkZXItYXZhdGFyIj4ke2F2YXRhckh0bWx9PC9kaXY+CiAgICAgIDxkaXY+CiAgICAgICAgPGRpdiBjbGFzcz0iY2hhdC1oZWFkZXItbmFtZSI+JHtlc2NIdG1sKG5hbWUpfTwvZGl2PgogICAgICA8L2Rpdj4KICAgIDwvZGl2PgogICAgPGRpdiBjbGFzcz0iY2hhdC1tZXNzYWdlcyIgaWQ9ImRtLW1lc3NhZ2VzIj4ke21zZ3MubWFwKHJlbmRlck1zZykuam9pbignJyl9PC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJ0eXBpbmctaW5kaWNhdG9yIiBpZD0iZG0tdHlwaW5nIj48L2Rpdj4KICAgIDxkaXYgY2xhc3M9ImNoYXQtaW5wdXQtd3JhcCI+CiAgICAgIDxkaXYgY2xhc3M9ImNoYXQtaW5wdXQtYm94Ij4KICAgICAgICA8aW5wdXQgdHlwZT0idGV4dCIgcGxhY2Vob2xkZXI9ItCh0L7QvtCx0YnQtdC90LjQtS4uLiIgaWQ9ImRtLWlucHV0IiBvbmtleWRvd249ImRtS2V5RG93bihldmVudCkiIG9uaW5wdXQ9ImRtVHlwaW5nKCkiLz4KICAgICAgICA8YnV0dG9uIGNsYXNzPSJzZW5kLWJ0biIgb25jbGljaz0ic2VuZERtTXNnKCkiPgogICAgICAgICAgPHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIGZpbGw9Im5vbmUiIHZpZXdCb3g9IjAgMCAyNCAyNCIgc3Ryb2tlPSJjdXJyZW50Q29sb3IiIHN0cm9rZS13aWR0aD0iMiI+PHBhdGggc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBkPSJNMTIgMTlsOSAyLTktMTgtOSAxOCA5LTJ6bTAgMHYtOCIvPjwvc3ZnPgogICAgICAgIDwvYnV0dG9uPgogICAgICA8L2Rpdj4KICAgIDwvZGl2PmA7CiAgc2Nyb2xsVG9Cb3R0b20oJ2RtLW1lc3NhZ2VzJyk7Cn0KCmZ1bmN0aW9uIGFwcGVuZE1lc3NhZ2VUb0RtKG1zZykgewogIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RtLW1lc3NhZ2VzJyk7CiAgaWYgKCFlbCkgcmV0dXJuOwogIGVsLmluc2VydEFkamFjZW50SFRNTCgnYmVmb3JlZW5kJywgcmVuZGVyTXNnKG1zZykpOwogIHNjcm9sbFRvQm90dG9tKCdkbS1tZXNzYWdlcycpOwp9Cgphc3luYyBmdW5jdGlvbiBzZW5kRG1Nc2coKSB7CiAgY29uc3QgaW5wID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RtLWlucHV0Jyk7CiAgaWYgKCFpbnAgfHwgIWFjdGl2ZUNvbnZJZCkgcmV0dXJuOwogIGNvbnN0IHRleHQgPSBpbnAudmFsdWUudHJpbSgpOwogIGlmICghdGV4dCkgcmV0dXJuOwogIGlucC52YWx1ZSA9ICcnOwogIHRyeSB7CiAgICBhd2FpdCBhcGkoJ1BPU1QnLCBgL2FwaS9jb252ZXJzYXRpb25zLyR7YWN0aXZlQ29udklkfS9tZXNzYWdlc2AsIHsgY29udGVudDogdGV4dCwgdHlwZTogJ3RleHQnIH0pOwogIH0gY2F0Y2ggKGUpIHsgc2hvd1RvYXN0KGUubWVzc2FnZSwgJ2Vycm9yJyk7IH0KfQoKZnVuY3Rpb24gZG1LZXlEb3duKGUpIHsgaWYgKGUua2V5ID09PSAnRW50ZXInICYmICFlLnNoaWZ0S2V5KSB7IGUucHJldmVudERlZmF1bHQoKTsgc2VuZERtTXNnKCk7IH0gfQoKZnVuY3Rpb24gZG1UeXBpbmcoKSB7CiAgaWYgKCFhY3RpdmVDb252SWQgfHwgIXdzIHx8IHdzLnJlYWR5U3RhdGUgIT09IDEpIHJldHVybjsKICBjbGVhclRpbWVvdXQodHlwaW5nVGltZXIpOwogIHdzLnNlbmQoSlNPTi5zdHJpbmdpZnkoeyB0eXBlOiAndHlwaW5nJywgY29udmVyc2F0aW9uSWQ6IGFjdGl2ZUNvbnZJZCB9KSk7Cn0KCmZ1bmN0aW9uIHVwZGF0ZUNvbnZQcmV2aWV3KCkgeyBsb2FkQ29udmVyc2F0aW9ucygpOyB9CgovLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZAKLy8gU0VSVkVSUwovLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZAKYXN5bmMgZnVuY3Rpb24gbG9hZFNlcnZlcnMoKSB7CiAgdHJ5IHsKICAgIHNlcnZlckxpc3QgPSBhd2FpdCBhcGkoJ0dFVCcsICcvYXBpL3NlcnZlcnMnKTsKICAgIGNvbnN0IHB1YiA9IGF3YWl0IGFwaSgnR0VUJywgJy9hcGkvc2VydmVycy9wdWJsaWMnKS5jYXRjaCgoKSA9PiBbXSk7CiAgICByZW5kZXJTZXJ2ZXJMaXN0KHNlcnZlckxpc3QpOwogIH0gY2F0Y2gge30KfQoKZnVuY3Rpb24gcmVuZGVyU2VydmVyTGlzdChsaXN0KSB7CiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VydmVyLWxpc3QnKTsKICBpZiAoIWxpc3QubGVuZ3RoKSB7CiAgICBlbC5pbm5lckhUTUwgPSAnPGRpdiBzdHlsZT0icGFkZGluZzoyMHB4O3RleHQtYWxpZ246Y2VudGVyO2NvbG9yOnZhcigtLXRleHQzKTtmb250LXNpemU6MTNweCI+0J3QtdGCINGB0LXRgNCy0LXRgNC+0LI8L2Rpdj4nOwogICAgcmV0dXJuOwogIH0KICBlbC5pbm5lckhUTUwgPSBsaXN0Lm1hcChzID0+IHsKICAgIGNvbnN0IGljb25VcmwgPSBzLmljb24gPyAocy5pY29uLnN0YXJ0c1dpdGgoJ2h0dHAnKSA/IHMuaWNvbiA6IEFQSSArIHMuaWNvbikgOiBudWxsOwogICAgY29uc3QgaWNvbkh0bWwgPSBpY29uVXJsID8gYDxpbWcgc3JjPSIke2ljb25Vcmx9IiBzdHlsZT0id2lkdGg6MTAwJTtoZWlnaHQ6MTAwJTtvYmplY3QtZml0OmNvdmVyIj5gIDogJ/CflqXvuI8nOwogICAgY29uc3QgYWN0aXZlID0gcy5pZCA9PT0gYWN0aXZlU2VydmVySWQgPyAnYWN0aXZlJyA6ICcnOwogICAgcmV0dXJuIGA8ZGl2IGNsYXNzPSJzZXJ2ZXItaXRlbSAke2FjdGl2ZX0iIG9uY2xpY2s9Im9wZW5TZXJ2ZXIoJyR7cy5pZH0nKSI+CiAgICAgIDxkaXYgY2xhc3M9InNlcnZlci1pY29uIj4ke2ljb25IdG1sfTwvZGl2PgogICAgICA8ZGl2PgogICAgICAgIDxkaXYgY2xhc3M9InNlcnZlci1uYW1lIj4ke2VzY0h0bWwocy5uYW1lKX08L2Rpdj4KICAgICAgICA8ZGl2IGNsYXNzPSJzZXJ2ZXItbWVtYmVycyI+JHtzLm1lbWJlckNvdW50fSDRg9GH0LDRgdGC0L3QuNC60L7QsjwvZGl2PgogICAgICA8L2Rpdj4KICAgIDwvZGl2PmA7CiAgfSkuam9pbignJyk7Cn0KCmFzeW5jIGZ1bmN0aW9uIG9wZW5TZXJ2ZXIoaWQpIHsKICBhY3RpdmVTZXJ2ZXJJZCA9IGlkOwogIHJlbmRlclNlcnZlckxpc3Qoc2VydmVyTGlzdCk7CiAgdHJ5IHsKICAgIGNvbnN0IHNlcnZlciA9IGF3YWl0IGFwaSgnR0VUJywgYC9hcGkvc2VydmVycy8ke2lkfWApOwogICAgcmVuZGVyU2VydmVyQ2hhbm5lbHMoc2VydmVyKTsKICAgIGlmICh3cyAmJiB3cy5yZWFkeVN0YXRlID09PSAxKSB3cy5zZW5kKEpTT04uc3RyaW5naWZ5KHsgdHlwZTogJ3N1YnNjcmliZV9zZXJ2ZXInLCBzZXJ2ZXJJZDogaWQgfSkpOwogIH0gY2F0Y2ggKGUpIHsgc2hvd1RvYXN0KGUubWVzc2FnZSwgJ2Vycm9yJyk7IH0KfQoKZnVuY3Rpb24gcmVuZGVyU2VydmVyQ2hhbm5lbHMoc2VydmVyKSB7CiAgY29uc3Qgc2lkZWJhciA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzZXJ2ZXItY2hhbm5lbC1zaWRlYmFyJyk7CiAgY29uc3QgY2hhbm5lbHMgPSBzZXJ2ZXIuY2hhbm5lbHMgfHwgW107CiAgY29uc3QgdGV4dENoYW5uZWxzID0gY2hhbm5lbHMuZmlsdGVyKGMgPT4gYy50eXBlID09PSAndGV4dCcpOwoKICBzaWRlYmFyLmlubmVySFRNTCA9IGAKICAgIDxkaXYgY2xhc3M9InNpZGViYXItaGVhZGVyIj4KICAgICAgPGRpdiBzdHlsZT0iZm9udC1zaXplOjE1cHg7Zm9udC13ZWlnaHQ6NzAwIj4ke2VzY0h0bWwoc2VydmVyLm5hbWUpfTwvZGl2PgogICAgICA8ZGl2IHN0eWxlPSJmb250LXNpemU6MTJweDtjb2xvcjp2YXIoLS10ZXh0MikiPiR7c2VydmVyLm1lbWJlckNvdW50fSDRg9GH0LDRgdGC0L3QuNC60L7QsjwvZGl2PgogICAgPC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJjaGFubmVsLWxpc3QiPgogICAgICA8ZGl2IGNsYXNzPSJjaGFubmVsLXNlY3Rpb24iPgogICAgICAgIDxkaXYgY2xhc3M9ImNoYW5uZWwtc2VjdGlvbi1uYW1lIj7QmtCw0L3QsNC70Ys8L2Rpdj4KICAgICAgICAke3RleHRDaGFubmVscy5tYXAoY2ggPT4gYAogICAgICAgICAgPGRpdiBjbGFzcz0iY2hhbm5lbC1pdGVtICR7Y2guaWQgPT09IGFjdGl2ZUNoYW5uZWxJZCA/ICdhY3RpdmUnIDogJyd9IiBvbmNsaWNrPSJvcGVuQ2hhbm5lbCgnJHtjaC5pZH0nLCcke3NlcnZlci5pZH0nLCcke2VzY0h0bWwoY2gubmFtZSl9JykiPgogICAgICAgICAgICA8c3BhbiBjbGFzcz0iY2hhbm5lbC1oYXNoIj4jPC9zcGFuPgogICAgICAgICAgICAke2VzY0h0bWwoY2gubmFtZSl9CiAgICAgICAgICA8L2Rpdj4KICAgICAgICBgKS5qb2luKCcnKX0KICAgICAgICAke3RleHRDaGFubmVscy5sZW5ndGggPT09IDAgPyAnPGRpdiBzdHlsZT0iZm9udC1zaXplOjEycHg7Y29sb3I6dmFyKC0tdGV4dDMpO3BhZGRpbmc6OHB4Ij7QndC10YIg0LrQsNC90LDQu9C+0LI8L2Rpdj4nIDogJyd9CiAgICAgIDwvZGl2PgogICAgPC9kaXY+CiAgICA8ZGl2IHN0eWxlPSJwYWRkaW5nOjEycHg7Ym9yZGVyLXRvcDoxcHggc29saWQgdmFyKC0tYm9yZGVyKSI+CiAgICAgIDxidXR0b24gY2xhc3M9ImNyZWF0ZS1zZXJ2ZXItYnRuIiBvbmNsaWNrPSJvcGVuQ3JlYXRlQ2hhbm5lbCgnJHtzZXJ2ZXIuaWR9JykiPisg0JTQvtCx0LDQstC40YLRjCDQutCw0L3QsNC7PC9idXR0b24+CiAgICA8L2Rpdj5gOwp9Cgphc3luYyBmdW5jdGlvbiBvcGVuQ2hhbm5lbChjaGFubmVsSWQsIHNlcnZlcklkLCBjaGFubmVsTmFtZSkgewogIGFjdGl2ZUNoYW5uZWxJZCA9IGNoYW5uZWxJZDsKICAvLyBSZS1yZW5kZXIgY2hhbm5lbCBzaWRlYmFyIHRvIHVwZGF0ZSBhY3RpdmUKICBpZiAoYWN0aXZlU2VydmVySWQpIG9wZW5TZXJ2ZXIoYWN0aXZlU2VydmVySWQpLmNhdGNoKCgpID0+IHt9KTsKCiAgdHJ5IHsKICAgIGNvbnN0IG1zZ3MgPSBhd2FpdCBhcGkoJ0dFVCcsIGAvYXBpL2NoYW5uZWxzLyR7Y2hhbm5lbElkfS9tZXNzYWdlcz9saW1pdD01MGApOwogICAgY2hhbm5lbE1lc3NhZ2VzW2NoYW5uZWxJZF0gPSBtc2dzOwogIH0gY2F0Y2ggeyBjaGFubmVsTWVzc2FnZXNbY2hhbm5lbElkXSA9IFtdOyB9CgogIHJlbmRlckNoYW5uZWxDaGF0KGNoYW5uZWxJZCwgY2hhbm5lbE5hbWUpOwp9CgpmdW5jdGlvbiByZW5kZXJDaGFubmVsQ2hhdChjaGFubmVsSWQsIGNoYW5uZWxOYW1lKSB7CiAgY29uc3QgbXNncyA9IGNoYW5uZWxNZXNzYWdlc1tjaGFubmVsSWRdIHx8IFtdOwogIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjaGFubmVsLWNoYXQtYXJlYScpLmlubmVySFRNTCA9IGAKICAgIDxkaXYgY2xhc3M9ImNoYXQtaGVhZGVyIj4KICAgICAgPHNwYW4gY2xhc3M9ImNoYW5uZWwtaGFzaCIgc3R5bGU9ImZvbnQtc2l6ZToyMnB4O2NvbG9yOnZhcigtLXRleHQyKSI+Izwvc3Bhbj4KICAgICAgPGRpdj4KICAgICAgICA8ZGl2IGNsYXNzPSJjaGF0LWhlYWRlci1uYW1lIj4ke2VzY0h0bWwoY2hhbm5lbE5hbWUpfTwvZGl2PgogICAgICA8L2Rpdj4KICAgIDwvZGl2PgogICAgPGRpdiBjbGFzcz0iY2hhdC1tZXNzYWdlcyIgaWQ9ImNoLW1lc3NhZ2VzIj4ke21zZ3MubWFwKHJlbmRlckNoYW5uZWxNc2cpLmpvaW4oJycpfTwvZGl2PgogICAgPGRpdiBjbGFzcz0idHlwaW5nLWluZGljYXRvciIgaWQ9ImNoLXR5cGluZyI+PC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJjaGF0LWlucHV0LXdyYXAiPgogICAgICA8ZGl2IGNsYXNzPSJjaGF0LWlucHV0LWJveCI+CiAgICAgICAgPGlucHV0IHR5cGU9InRleHQiIHBsYWNlaG9sZGVyPSLQodC+0L7QsdGJ0LXQvdC40LUg0LIgIyR7ZXNjSHRtbChjaGFubmVsTmFtZSl9Li4uIiBpZD0iY2gtaW5wdXQiIG9ua2V5ZG93bj0iY2hLZXlEb3duKGV2ZW50KSIvPgogICAgICAgIDxidXR0b24gY2xhc3M9InNlbmQtYnRuIiBvbmNsaWNrPSJzZW5kQ2hhbm5lbE1zZygpIj4KICAgICAgICAgIDxzdmcgd2lkdGg9IjE4IiBoZWlnaHQ9IjE4IiBmaWxsPSJub25lIiB2aWV3Qm94PSIwIDAgMjQgMjQiIHN0cm9rZT0iY3VycmVudENvbG9yIiBzdHJva2Utd2lkdGg9IjIiPjxwYXRoIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIgZD0iTTEyIDE5bDkgMi05LTE4LTkgMTggOS0yem0wIDB2LTgiLz48L3N2Zz4KICAgICAgICA8L2J1dHRvbj4KICAgICAgPC9kaXY+CiAgICA8L2Rpdj5gOwogIHNjcm9sbFRvQm90dG9tKCdjaC1tZXNzYWdlcycpOwp9CgpmdW5jdGlvbiBhcHBlbmRNZXNzYWdlVG9DaGFubmVsKG1zZykgewogIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NoLW1lc3NhZ2VzJyk7CiAgaWYgKCFlbCkgcmV0dXJuOwogIGVsLmluc2VydEFkamFjZW50SFRNTCgnYmVmb3JlZW5kJywgcmVuZGVyQ2hhbm5lbE1zZyhtc2cpKTsKICBzY3JvbGxUb0JvdHRvbSgnY2gtbWVzc2FnZXMnKTsKfQoKYXN5bmMgZnVuY3Rpb24gc2VuZENoYW5uZWxNc2coKSB7CiAgY29uc3QgaW5wID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2NoLWlucHV0Jyk7CiAgaWYgKCFpbnAgfHwgIWFjdGl2ZUNoYW5uZWxJZCkgcmV0dXJuOwogIGNvbnN0IHRleHQgPSBpbnAudmFsdWUudHJpbSgpOwogIGlmICghdGV4dCkgcmV0dXJuOwogIGlucC52YWx1ZSA9ICcnOwogIHRyeSB7CiAgICBhd2FpdCBhcGkoJ1BPU1QnLCBgL2FwaS9jaGFubmVscy8ke2FjdGl2ZUNoYW5uZWxJZH0vbWVzc2FnZXNgLCB7IGNvbnRlbnQ6IHRleHQsIHR5cGU6ICd0ZXh0JyB9KTsKICB9IGNhdGNoIChlKSB7IHNob3dUb2FzdChlLm1lc3NhZ2UsICdlcnJvcicpOyB9Cn0KCmZ1bmN0aW9uIGNoS2V5RG93bihlKSB7IGlmIChlLmtleSA9PT0gJ0VudGVyJyAmJiAhZS5zaGlmdEtleSkgeyBlLnByZXZlbnREZWZhdWx0KCk7IHNlbmRDaGFubmVsTXNnKCk7IH0gfQoKLy8gQ1JFQVRFIFNFUlZFUiBNT0RBTApmdW5jdGlvbiBvcGVuQ3JlYXRlU2VydmVyKCkgewogIHNob3dNb2RhbChgCiAgICA8aDI+0KHQvtC30LTQsNGC0Ywg0YHQtdGA0LLQtdGAPC9oMj4KICAgIDxkaXYgY2xhc3M9ImZvcm0tZ3JvdXAiPjxsYWJlbD7QndCw0LfQstCw0L3QuNC1PC9sYWJlbD48aW5wdXQgaWQ9Im5ldy1zcnYtbmFtZSIgdHlwZT0idGV4dCIgcGxhY2Vob2xkZXI9ItCc0L7QuSDRgdC10YDQstC10YAiLz48L2Rpdj4KICAgIDxkaXYgY2xhc3M9ImZvcm0tZ3JvdXAiPjxsYWJlbD7QntC/0LjRgdCw0L3QuNC1ICjQvdC10L7QsdGP0LfQsNGC0LXQu9GM0L3Qvik8L2xhYmVsPjxpbnB1dCBpZD0ibmV3LXNydi1kZXNjIiB0eXBlPSJ0ZXh0IiBwbGFjZWhvbGRlcj0i0J4g0YfRkdC8INGN0YLQvtGCINGB0LXRgNCy0LXRgD8iLz48L2Rpdj4KICAgIDxkaXYgY2xhc3M9ImZvcm0tZ3JvdXAiPgogICAgICA8bGFiZWw+0J/Rg9Cx0LvQuNGH0L3Ri9C5INGB0LXRgNCy0LXRgDwvbGFiZWw+CiAgICAgIDxzZWxlY3QgaWQ9Im5ldy1zcnYtcHVibGljIiBzdHlsZT0id2lkdGg6MTAwJTtiYWNrZ3JvdW5kOnZhcigtLWJnMyk7Ym9yZGVyOjFweCBzb2xpZCB2YXIoLS1ib3JkZXIpO2JvcmRlci1yYWRpdXM6OHB4O3BhZGRpbmc6MTBweDtjb2xvcjp2YXIoLS10ZXh0KTtmb250LXNpemU6MTRweDtmb250LWZhbWlseTppbmhlcml0O291dGxpbmU6bm9uZSI+CiAgICAgICAgPG9wdGlvbiB2YWx1ZT0iMSI+0JTQsCDigJQg0LLQuNC00LXQvSDQsiDQv9C+0LjRgdC60LU8L29wdGlvbj4KICAgICAgICA8b3B0aW9uIHZhbHVlPSIwIj7QndC10YIg4oCUINGC0L7Qu9GM0LrQviDQv9C+INC60L7QtNGDPC9vcHRpb24+CiAgICAgIDwvc2VsZWN0PgogICAgPC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJtb2RhbC1mb290ZXIiPgogICAgICA8YnV0dG9uIGNsYXNzPSJidG4tc2Vjb25kYXJ5IiBvbmNsaWNrPSJjbG9zZU1vZGFsKCkiPtCe0YLQvNC10L3QsDwvYnV0dG9uPgogICAgICA8YnV0dG9uIGNsYXNzPSJidG4gYnRuLXByaW1hcnkiIHN0eWxlPSJmbGV4OjEiIG9uY2xpY2s9ImNyZWF0ZVNlcnZlcigpIj7QodC+0LfQtNCw0YLRjDwvYnV0dG9uPgogICAgPC9kaXY+YCk7Cn0KCmFzeW5jIGZ1bmN0aW9uIGNyZWF0ZVNlcnZlcigpIHsKICBjb25zdCBuYW1lID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ25ldy1zcnYtbmFtZScpLnZhbHVlLnRyaW0oKTsKICBjb25zdCBkZXNjcmlwdGlvbiA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCduZXctc3J2LWRlc2MnKS52YWx1ZS50cmltKCk7CiAgY29uc3QgaXNQdWJsaWMgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbmV3LXNydi1wdWJsaWMnKS52YWx1ZSA9PT0gJzEnOwogIGlmICghbmFtZSkgcmV0dXJuOwogIHRyeSB7CiAgICBjb25zdCBzID0gYXdhaXQgYXBpKCdQT1NUJywgJy9hcGkvc2VydmVycycsIHsgbmFtZSwgZGVzY3JpcHRpb24sIGlzUHVibGljIH0pOwogICAgY2xvc2VNb2RhbCgpOwogICAgc2hvd1RvYXN0KCfinIUg0KHQtdGA0LLQtdGAINGB0L7Qt9C00LDQvSEnLCAnc3VjY2VzcycpOwogICAgYXdhaXQgbG9hZFNlcnZlcnMoKTsKICAgIG9wZW5TZXJ2ZXIocy5pZCk7CiAgICBzaG93UGFuZWwoJ3NlcnZlcnMnKTsKICB9IGNhdGNoIChlKSB7IHNob3dUb2FzdChlLm1lc3NhZ2UsICdlcnJvcicpOyB9Cn0KCmZ1bmN0aW9uIG9wZW5Kb2luU2VydmVyKCkgewogIHNob3dNb2RhbChgCiAgICA8aDI+0JLQvtC50YLQuCDQvdCwINGB0LXRgNCy0LXRgDwvaDI+CiAgICA8ZGl2IGNsYXNzPSJmb3JtLWdyb3VwIj48bGFiZWw+0JrQvtC0INC/0YDQuNCz0LvQsNGI0LXQvdC40Y88L2xhYmVsPjxpbnB1dCBpZD0iam9pbi1jb2RlIiB0eXBlPSJ0ZXh0IiBwbGFjZWhvbGRlcj0iWFhYWFhYWFgiLz48L2Rpdj4KICAgIDxkaXYgY2xhc3M9Im1vZGFsLWZvb3RlciI+CiAgICAgIDxidXR0b24gY2xhc3M9ImJ0bi1zZWNvbmRhcnkiIG9uY2xpY2s9ImNsb3NlTW9kYWwoKSI+0J7RgtC80LXQvdCwPC9idXR0b24+CiAgICAgIDxidXR0b24gY2xhc3M9ImJ0biBidG4tcHJpbWFyeSIgc3R5bGU9ImZsZXg6MSIgb25jbGljaz0iam9pblNlcnZlcigpIj7QktC+0LnRgtC4PC9idXR0b24+CiAgICA8L2Rpdj5gKTsKfQoKYXN5bmMgZnVuY3Rpb24gam9pblNlcnZlcigpIHsKICBjb25zdCBjb2RlID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2pvaW4tY29kZScpLnZhbHVlLnRyaW0oKS50b1VwcGVyQ2FzZSgpOwogIGlmICghY29kZSkgcmV0dXJuOwogIHRyeSB7CiAgICBjb25zdCBzID0gYXdhaXQgYXBpKCdQT1NUJywgYC9hcGkvc2VydmVycy9qb2luLyR7Y29kZX1gLCB7fSk7CiAgICBjbG9zZU1vZGFsKCk7CiAgICBzaG93VG9hc3QoJ+KchSDQktGLINCy0L7RiNC70Lgg0L3QsCDRgdC10YDQstC10YAhJywgJ3N1Y2Nlc3MnKTsKICAgIGF3YWl0IGxvYWRTZXJ2ZXJzKCk7CiAgICBvcGVuU2VydmVyKHMuaWQpOwogICAgc2hvd1BhbmVsKCdzZXJ2ZXJzJyk7CiAgfSBjYXRjaCAoZSkgeyBzaG93VG9hc3QoZS5tZXNzYWdlLCAnZXJyb3InKTsgfQp9CgpmdW5jdGlvbiBvcGVuQ3JlYXRlQ2hhbm5lbChzZXJ2ZXJJZCkgewogIHNob3dNb2RhbChgCiAgICA8aDI+0KHQvtC30LTQsNGC0Ywg0LrQsNC90LDQuzwvaDI+CiAgICA8ZGl2IGNsYXNzPSJmb3JtLWdyb3VwIj48bGFiZWw+0J3QsNC30LLQsNC90LjQtTwvbGFiZWw+PGlucHV0IGlkPSJuZXctY2gtbmFtZSIgdHlwZT0idGV4dCIgcGxhY2Vob2xkZXI9ItC+0YHQvdC+0LLQvdC+0LkiLz48L2Rpdj4KICAgIDxkaXYgY2xhc3M9Im1vZGFsLWZvb3RlciI+CiAgICAgIDxidXR0b24gY2xhc3M9ImJ0bi1zZWNvbmRhcnkiIG9uY2xpY2s9ImNsb3NlTW9kYWwoKSI+0J7RgtC80LXQvdCwPC9idXR0b24+CiAgICAgIDxidXR0b24gY2xhc3M9ImJ0biBidG4tcHJpbWFyeSIgc3R5bGU9ImZsZXg6MSIgb25jbGljaz0iY3JlYXRlQ2hhbm5lbCgnJHtzZXJ2ZXJJZH0nKSI+0KHQvtC30LTQsNGC0Yw8L2J1dHRvbj4KICAgIDwvZGl2PmApOwp9Cgphc3luYyBmdW5jdGlvbiBjcmVhdGVDaGFubmVsKHNlcnZlcklkKSB7CiAgY29uc3QgbmFtZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCduZXctY2gtbmFtZScpLnZhbHVlLnRyaW0oKS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1xzKy9nLCAnLScpOwogIGlmICghbmFtZSkgcmV0dXJuOwogIHRyeSB7CiAgICBhd2FpdCBhcGkoJ1BPU1QnLCBgL2FwaS9zZXJ2ZXJzLyR7c2VydmVySWR9L2NoYW5uZWxzYCwgeyBuYW1lLCB0eXBlOiAndGV4dCcgfSk7CiAgICBjbG9zZU1vZGFsKCk7CiAgICBzaG93VG9hc3QoJ+KchSDQmtCw0L3QsNC7INGB0L7Qt9C00LDQvSEnLCAnc3VjY2VzcycpOwogICAgb3BlblNlcnZlcihzZXJ2ZXJJZCk7CiAgfSBjYXRjaCAoZSkgeyBzaG93VG9hc3QoZS5tZXNzYWdlLCAnZXJyb3InKTsgfQp9CgovLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZAKLy8gU0hPUAovLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZAKZnVuY3Rpb24gc3dpdGNoU2hvcFRhYih0YWIpIHsKICBzaG9wVGFiID0gdGFiOwogIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJy5zaG9wLXRhYicpLmZvckVhY2goKGVsLCBpKSA9PiB7CiAgICBlbC5jbGFzc0xpc3QudG9nZ2xlKCdhY3RpdmUnLCBbJ3ByZW1pdW0nLCdjb2lucycsJ2dpZnRzJ11baV0gPT09IHRhYik7CiAgfSk7CiAgcmVuZGVyU2hvcCgpOwp9Cgphc3luYyBmdW5jdGlvbiBsb2FkR2lmdHNDYXRhbG9nKCkgewogIHRyeSB7IGdpZnRzQ2F0YWxvZyA9IGF3YWl0IGFwaSgnR0VUJywgJy9hcGkvZ2lmdHMvY2F0YWxvZycpOyB9IGNhdGNoIHt9Cn0KCmFzeW5jIGZ1bmN0aW9uIGxvYWRDb2luUGFja2FnZXMoKSB7CiAgdHJ5IHsgY29pblBhY2thZ2VzID0gYXdhaXQgYXBpKCdHRVQnLCAnL2FwaS9jb2lucy9wYWNrYWdlcycpOyB9IGNhdGNoIHt9Cn0KCmFzeW5jIGZ1bmN0aW9uIHJlbmRlclNob3AoKSB7CiAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2hvcC1jb250ZW50Jyk7CiAgaWYgKCFlbCkgcmV0dXJuOwoKICBpZiAoc2hvcFRhYiA9PT0gJ3ByZW1pdW0nKSB7CiAgICBjb25zdCBpc1ByZW0gPSBtZT8ucHJlbWl1bTsKICAgIGVsLmlubmVySFRNTCA9IGAKICAgICAgPGRpdiBjbGFzcz0icHJlbWl1bS1oZXJvIj4KICAgICAgICA8ZGl2IGNsYXNzPSJwcmVtaXVtLWNyb3duIj7wn5GRPC9kaXY+CiAgICAgICAgPGRpdj4KICAgICAgICAgIDxoMj5PbW5pIFByZW1pdW08L2gyPgogICAgICAgICAgPHA+0KDQsNC30LHQu9C+0LrQuNGA0YPQuSDRjdC60YHQutC70Y7Qt9C40LLQvdGL0LUg0LLQvtC30LzQvtC20L3QvtGB0YLQuCDQuCDQv9C+0LTQtNC10YDQttC4INGA0LDQt9Cy0LjRgtC40LUgT21uaTwvcD4KICAgICAgICAgICR7aXNQcmVtID8gYDxkaXYgc3R5bGU9ImNvbG9yOnZhcigtLWdyZWVuKTtmb250LXdlaWdodDo2MDA7bWFyZ2luLXRvcDoxMHB4Ij7inIUg0JDQutGC0LjQstC90L4g0LTQvjogJHtuZXcgRGF0ZShpc1ByZW0uZXhwaXJlc0F0KS50b0xvY2FsZURhdGVTdHJpbmcoJ3J1LVJVJyl9PC9kaXY+YAogICAgICAgICAgICAgICAgICAgOiBgPGRpdiBjbGFzcz0icHJpY2UtdGFnIj7igr0zOSA8c3Bhbj4vINC80LXRgdGP0YY8L3NwYW4+PC9kaXY+YH0KICAgICAgICA8L2Rpdj4KICAgICAgPC9kaXY+CiAgICAgIDxkaXYgY2xhc3M9ImZlYXR1cmVzLWdyaWQiPgogICAgICAgIDxkaXYgY2xhc3M9ImZlYXR1cmUtY2FyZCI+PGRpdiBjbGFzcz0iZmVhdHVyZS1pY29uIj7wn46oPC9kaXY+PGRpdj48aDQ+0KLQtdC80Ysg0L7RhNC+0YDQvNC70LXQvdC40Y88L2g0PjxwPjgg0YPQvdC40LrQsNC70YzQvdGL0YUg0YbQstC10YLQvtCy0YvRhSDRgdGF0LXQvDwvcD48L2Rpdj48L2Rpdj4KICAgICAgICA8ZGl2IGNsYXNzPSJmZWF0dXJlLWNhcmQiPjxkaXYgY2xhc3M9ImZlYXR1cmUtaWNvbiI+8J+PhTwvZGl2PjxkaXY+PGg0PtCX0L3QsNGH0L7QuiBQcmVtaXVtPC9oND48cD7QmtCw0YHRgtC+0LzQvdGL0Lkg0LfQvdCw0YfQvtC6INCyINC/0YDQvtGE0LjQu9C1PC9wPjwvZGl2PjwvZGl2PgogICAgICAgIDxkaXYgY2xhc3M9ImZlYXR1cmUtY2FyZCI+PGRpdiBjbGFzcz0iZmVhdHVyZS1pY29uIj7wn5OBPC9kaXY+PGRpdj48aDQ+0KTQsNC50LvRiyDQtNC+IDUwMCDQnNCRPC9oND48cD7QntCx0YvRh9C90YvQuSDQu9C40LzQuNGCIDEwMCDQnNCRPC9wPjwvZGl2PjwvZGl2PgogICAgICAgIDxkaXYgY2xhc3M9ImZlYXR1cmUtY2FyZCI+PGRpdiBjbGFzcz0iZmVhdHVyZS1pY29uIj7wn46BPC9kaXY+PGRpdj48aDQ+0K3QutGB0LrQu9GO0LfQuNCy0L3Ri9C1INC/0L7QtNCw0YDQutC4PC9oND48cD7QlNC+0YHRgtGD0L8g0Log0LvQtdCz0LXQvdC00LDRgNC90YvQvCDQv9C+0LTQsNGA0LrQsNC8PC9wPjwvZGl2PjwvZGl2PgogICAgICAgIDxkaXYgY2xhc3M9ImZlYXR1cmUtY2FyZCI+PGRpdiBjbGFzcz0iZmVhdHVyZS1pY29uIj7imqE8L2Rpdj48ZGl2PjxoND7Qn9GA0LjQvtGA0LjRgtC10YLQvdCw0Y8g0L/QvtC00LTQtdGA0LbQutCwPC9oND48cD7QntGC0LLQtdGCINCyINGC0LXRh9C10L3QuNC1INGH0LDRgdCwPC9wPjwvZGl2PjwvZGl2PgogICAgICAgIDxkaXYgY2xhc3M9ImZlYXR1cmUtY2FyZCI+PGRpdiBjbGFzcz0iZmVhdHVyZS1pY29uIj7wn4yfPC9kaXY+PGRpdj48aDQ+0KHQv9C10YbQuNCw0LvRjNC90YvQuSDRgdGC0LDRgtGD0YE8L2g0PjxwPtCX0L3QsNGH0L7QuiDRgNGP0LTQvtC8INGBINC40LzQtdC90LXQvDwvcD48L2Rpdj48L2Rpdj4KICAgICAgPC9kaXY+CiAgICAgICR7IWlzUHJlbSA/IGA8YnV0dG9uIGNsYXNzPSJidG4gYnRuLXByaW1hcnkiIHN0eWxlPSJtYXgtd2lkdGg6MzAwcHgiIG9uY2xpY2s9ImJ1eVByZW1pdW0oKSI+0JrRg9C/0LjRgtGMIFByZW1pdW0g4oCUIOKCvTM5L9C80LXRgTwvYnV0dG9uPmAgOiAnJ31gOwogIH0KCiAgaWYgKHNob3BUYWIgPT09ICdjb2lucycpIHsKICAgIGlmICghY29pblBhY2thZ2VzLmxlbmd0aCkgYXdhaXQgbG9hZENvaW5QYWNrYWdlcygpOwogICAgZWwuaW5uZXJIVE1MID0gYAogICAgICA8ZGl2IGNsYXNzPSJjb2lucy1iYWxhbmNlLWJhciIgc3R5bGU9Im1hcmdpbi1ib3R0b206MjRweCI+CiAgICAgICAgPHNwYW4+8J+qmTwvc3Bhbj4KICAgICAgICA8c3Bhbj7QktCw0Ygg0LHQsNC70LDQvdGBOiAke21lPy5jb2lucyA/PyAwfSDQvNC+0L3QtdGCPC9zcGFuPgogICAgICA8L2Rpdj4KICAgICAgPGRpdiBjbGFzcz0iY29pbnMtZ3JpZCI+CiAgICAgICAgJHtjb2luUGFja2FnZXMubWFwKChwa2csIGkpID0+IGAKICAgICAgICAgIDxkaXYgY2xhc3M9ImNvaW4tY2FyZCAke2kgPT09IDIgPyAncG9wdWxhcicgOiAnJ30iPgogICAgICAgICAgICA8ZGl2IGNsYXNzPSJjb2luLWFtb3VudCI+JHtwa2cuY29pbnN9PC9kaXY+CiAgICAgICAgICAgIDxkaXYgY2xhc3M9ImNvaW4tbGFiZWwiPiR7cGtnLmxhYmVsfTwvZGl2PgogICAgICAgICAgICA8ZGl2IGNsYXNzPSJjb2luLXByaWNlIj7igr0ke3BrZy5wcmljZVJ1Yn08L2Rpdj4KICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz0iY29pbi1idG4iIG9uY2xpY2s9ImJ1eUNvaW5zKCcke3BrZy5pZH0nKSI+0JrRg9C/0LjRgtGMPC9idXR0b24+CiAgICAgICAgICA8L2Rpdj4KICAgICAgICBgKS5qb2luKCcnKX0KICAgICAgPC9kaXY+YDsKICB9CgogIGlmIChzaG9wVGFiID09PSAnZ2lmdHMnKSB7CiAgICBpZiAoIWdpZnRzQ2F0YWxvZy5sZW5ndGgpIGF3YWl0IGxvYWRHaWZ0c0NhdGFsb2coKTsKICAgIGxldCBiYWxhbmNlID0gbWU/LmNvaW5zID8/IDA7CiAgICB0cnkgeyBjb25zdCBiID0gYXdhaXQgYXBpKCdHRVQnLCAnL2FwaS9jb2lucy9iYWxhbmNlJyk7IGJhbGFuY2UgPSBiLmNvaW5zOyBpZiAobWUpIG1lLmNvaW5zID0gYmFsYW5jZTsgfSBjYXRjaCB7fQogICAgZWwuaW5uZXJIVE1MID0gYAogICAgICA8ZGl2IGNsYXNzPSJnaWZ0cy1oZWFkZXIiPgogICAgICAgIDxkaXYgY2xhc3M9ImNvaW5zLWJhbGFuY2UtYmFyIj7wn6qZICR7YmFsYW5jZX0g0LzQvtC90LXRgjwvZGl2PgogICAgICAgIDxkaXYgc3R5bGU9ImNvbG9yOnZhcigtLXRleHQyKTtmb250LXNpemU6MTNweCI+0J/QvtC00LDRgNC60Lgg0L7RgtC/0YDQsNCy0LvRj9GO0YLRgdGPINC+0YIg0LHQvtGC0LAgT21uaUJvdDwvZGl2PgogICAgICA8L2Rpdj4KICAgICAgPGRpdiBjbGFzcz0iZ2lmdHMtZ3JpZCI+CiAgICAgICAgJHtnaWZ0c0NhdGFsb2cubWFwKGcgPT4gYAogICAgICAgICAgPGRpdiBjbGFzcz0iZ2lmdC1jYXJkIj4KICAgICAgICAgICAgPGRpdiBjbGFzcz0iZ2lmdC1iaWctZW1vamkiPiR7Zy5lbW9qaX08L2Rpdj4KICAgICAgICAgICAgPGg0PiR7ZXNjSHRtbChnLm5hbWUpfTwvaDQ+CiAgICAgICAgICAgIDxwPjxzcGFuIGNsYXNzPSJnaWZ0LXJhcml0eSAke2cucmFyaXR5fSI+JHtyYXJpdHlMYWJlbChnLnJhcml0eSl9PC9zcGFuPjwvcD4KICAgICAgICAgICAgPGRpdiBjbGFzcz0iZ2lmdC1jb3N0Ij7wn6qZICR7Zy5wcmljZUNvaW5zfSDQvNC+0L3QtdGCPC9kaXY+CiAgICAgICAgICAgIDxidXR0b24gY2xhc3M9ImdpZnQtYnV5LWJ0biIgb25jbGljaz0ib3BlbkJ1eUdpZnQoJyR7Zy5pZH0nKSI+0JrRg9C/0LjRgtGMINC/0L7QtNCw0YDQvtC6PC9idXR0b24+CiAgICAgICAgICA8L2Rpdj4KICAgICAgICBgKS5qb2luKCcnKX0KICAgICAgPC9kaXY+YDsKICB9Cn0KCmFzeW5jIGZ1bmN0aW9uIGJ1eVByZW1pdW0oKSB7CiAgdHJ5IHsKICAgIGNvbnN0IHJlcyA9IGF3YWl0IGFwaSgnR0VUJywgJy9hcGkvcHJlbWl1bS9jaGVja291dCcpOwogICAgaWYgKHJlcy5wYXlVcmwpIHdpbmRvdy5vcGVuKHJlcy5wYXlVcmwsICdfYmxhbmsnKTsKICAgIGVsc2Ugc2hvd1RvYXN0KCfQmNGB0L/QvtC70YzQt9GD0Lkg0L/RgNC+0LzQvtC60L7QtDogV0VYWlonLCAnaW5mbycpOwogIH0gY2F0Y2ggewogICAgc2hvd1RvYXN0KCfQmNGB0L/QvtC70YzQt9GD0Lkg0L/RgNC+0LzQvtC60L7QtCBXRVhaWiDQtNC70Y8g0LHQtdGB0L/Qu9Cw0YLQvdC+0LPQviBQcmVtaXVtIScsICdpbmZvJyk7CiAgICBvcGVuUHJvbW9Nb2RhbCgpOwogIH0KfQoKZnVuY3Rpb24gb3BlblByb21vTW9kYWwoKSB7CiAgc2hvd01vZGFsKGAKICAgIDxoMj7QkNC60YLQuNCy0LjRgNC+0LLQsNGC0Ywg0L/RgNC+0LzQvtC60L7QtDwvaDI+CiAgICA8ZGl2IGNsYXNzPSJmb3JtLWdyb3VwIj48bGFiZWw+0J/RgNC+0LzQvtC60L7QtDwvbGFiZWw+PGlucHV0IGlkPSJwcm9tby1jb2RlIiB0eXBlPSJ0ZXh0IiBwbGFjZWhvbGRlcj0iV0VYWloiLz48L2Rpdj4KICAgIDxkaXYgY2xhc3M9Im1vZGFsLWZvb3RlciI+CiAgICAgIDxidXR0b24gY2xhc3M9ImJ0bi1zZWNvbmRhcnkiIG9uY2xpY2s9ImNsb3NlTW9kYWwoKSI+0J7RgtC80LXQvdCwPC9idXR0b24+CiAgICAgIDxidXR0b24gY2xhc3M9ImJ0biBidG4tcHJpbWFyeSIgc3R5bGU9ImZsZXg6MSIgb25jbGljaz0iYWN0aXZhdGVQcm9tbygpIj7Qn9GA0LjQvNC10L3QuNGC0Yw8L2J1dHRvbj4KICAgIDwvZGl2PmApOwp9Cgphc3luYyBmdW5jdGlvbiBhY3RpdmF0ZVByb21vKCkgewogIGNvbnN0IGNvZGUgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncHJvbW8tY29kZScpLnZhbHVlLnRyaW0oKS50b1VwcGVyQ2FzZSgpOwogIGlmICghY29kZSkgcmV0dXJuOwogIHRyeSB7CiAgICBjb25zdCByZXMgPSBhd2FpdCBhcGkoJ1BPU1QnLCAnL2FwaS9wcmVtaXVtL2FjdGl2YXRlLXByb21vJywgeyBjb2RlIH0pOwogICAgY2xvc2VNb2RhbCgpOwogICAgc2hvd1RvYXN0KCfwn5GRIFByZW1pdW0g0LDQutGC0LjQstC40YDQvtCy0LDQvSEnLCAnc3VjY2VzcycpOwogICAgbWUgPSBhd2FpdCBhcGkoJ0dFVCcsICcvYXBpL2F1dGgvbWUnKTsKICAgIHJlbmRlclByb2ZpbGUoKTsKICAgIHJlbmRlclNob3AoKTsKICB9IGNhdGNoIChlKSB7IHNob3dUb2FzdChlLm1lc3NhZ2UsICdlcnJvcicpOyB9Cn0KCmFzeW5jIGZ1bmN0aW9uIGJ1eUNvaW5zKHBhY2thZ2VJZCkgewogIHRyeSB7CiAgICBjb25zdCByZXMgPSBhd2FpdCBhcGkoJ0dFVCcsIGAvYXBpL2NvaW5zL2NoZWNrb3V0P3BhY2thZ2VJZD0ke3BhY2thZ2VJZH1gKTsKICAgIGlmIChyZXMucGF5VXJsKSB3aW5kb3cub3BlbihyZXMucGF5VXJsLCAnX2JsYW5rJyk7CiAgfSBjYXRjaCAoZSkgeyBzaG93VG9hc3QoZS5tZXNzYWdlLCAnZXJyb3InKTsgfQp9CgpmdW5jdGlvbiBvcGVuQnV5R2lmdChnaWZ0SWQpIHsKICBjb25zdCBnaWZ0ID0gZ2lmdHNDYXRhbG9nLmZpbmQoZyA9PiBnLmlkID09PSBnaWZ0SWQpOwogIGlmICghZ2lmdCkgcmV0dXJuOwogIHNob3dNb2RhbChgCiAgICA8aDI+JHtnaWZ0LmVtb2ppfSAke2dpZnQubmFtZX08L2gyPgogICAgPHAgc3R5bGU9ImNvbG9yOnZhcigtLXRleHQyKTttYXJnaW4tYm90dG9tOjE2cHgiPtCf0L7QtNCw0YDQvtC6INCx0YPQtNC10YIg0L7RgtC/0YDQsNCy0LvQtdC9INCy0LDQvCDQvtGCINCx0L7RgtCwIDxzdHJvbmc+T21uaUJvdDwvc3Ryb25nPjwvcD4KICAgIDxkaXYgc3R5bGU9ImJhY2tncm91bmQ6dmFyKC0tYmczKTtib3JkZXItcmFkaXVzOjEwcHg7cGFkZGluZzoxNHB4O21hcmdpbi1ib3R0b206MTZweDtkaXNwbGF5OmZsZXg7anVzdGlmeS1jb250ZW50OnNwYWNlLWJldHdlZW4iPgogICAgICA8c3BhbiBzdHlsZT0iY29sb3I6dmFyKC0tdGV4dDIpIj7QodGC0L7QuNC80L7RgdGC0Yw8L3NwYW4+CiAgICAgIDxzcGFuIHN0eWxlPSJmb250LXdlaWdodDo3MDA7Y29sb3I6dmFyKC0teWVsbG93KSI+8J+qmSAke2dpZnQucHJpY2VDb2luc30g0LzQvtC90LXRgjwvc3Bhbj4KICAgIDwvZGl2PgogICAgPGRpdiBjbGFzcz0iZm9ybS1ncm91cCI+PGxhYmVsPtCh0L7QvtCx0YnQtdC90LjQtSAo0L3QtdC+0LHRj9C30LDRgtC10LvRjNC90L4pPC9sYWJlbD48aW5wdXQgaWQ9ImdpZnQtbXNnIiB0eXBlPSJ0ZXh0IiBwbGFjZWhvbGRlcj0i0JbQtdC70LDRji4uLiIvPjwvZGl2PgogICAgPGRpdiBjbGFzcz0ibW9kYWwtZm9vdGVyIj4KICAgICAgPGJ1dHRvbiBjbGFzcz0iYnRuLXNlY29uZGFyeSIgb25jbGljaz0iY2xvc2VNb2RhbCgpIj7QntGC0LzQtdC90LA8L2J1dHRvbj4KICAgICAgPGJ1dHRvbiBjbGFzcz0iYnRuIGJ0bi1wcmltYXJ5IiBzdHlsZT0iZmxleDoxIiBvbmNsaWNrPSJidXlHaWZ0RnJvbUJvdCgnJHtnaWZ0SWR9JykiPtCa0YPQv9C40YLRjCDQt9CwIPCfqpkgJHtnaWZ0LnByaWNlQ29pbnN9PC9idXR0b24+CiAgICA8L2Rpdj5gKTsKfQoKYXN5bmMgZnVuY3Rpb24gYnV5R2lmdEZyb21Cb3QoZ2lmdElkKSB7CiAgY29uc3QgbWVzc2FnZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdnaWZ0LW1zZycpPy52YWx1ZT8udHJpbSgpIHx8IG51bGw7CiAgdHJ5IHsKICAgIGNvbnN0IHJlcyA9IGF3YWl0IGFwaSgnUE9TVCcsICcvYXBpL3dlYi9zaG9wL2dpZnQnLCB7IGdpZnRJZCwgbWVzc2FnZSB9KTsKICAgIGNsb3NlTW9kYWwoKTsKICAgIHNob3dUb2FzdCgn8J+OgSDQn9C+0LTQsNGA0L7QuiDQv9C+0LvRg9GH0LXQvSDQvtGCIE9tbmlCb3QhJywgJ3N1Y2Nlc3MnKTsKICAgIGlmIChtZSkgbWUuY29pbnMgPSByZXMubmV3QmFsYW5jZTsKICAgIGF3YWl0IGxvYWRDb252ZXJzYXRpb25zKCk7CiAgICByZW5kZXJTaG9wKCk7CiAgfSBjYXRjaCAoZSkgeyBzaG93VG9hc3QoZS5tZXNzYWdlLCAnZXJyb3InKTsgfQp9CgovLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZAKLy8gUFJPRklMRQovLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZAKYXN5bmMgZnVuY3Rpb24gcmVuZGVyUHJvZmlsZSgpIHsKICBpZiAoIW1lKSByZXR1cm47CiAgdHJ5IHsgbWUgPSBhd2FpdCBhcGkoJ0dFVCcsICcvYXBpL2F1dGgvbWUnKTsgfSBjYXRjaCB7fQogIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3Byb2ZpbGUtY2FyZCcpOwogIGlmICghZWwpIHJldHVybjsKICBjb25zdCBhdmF0YXJVcmwgPSBtZS5hdmF0YXIgPyAobWUuYXZhdGFyLnN0YXJ0c1dpdGgoJ2h0dHAnKSA/IG1lLmF2YXRhciA6IEFQSSArIG1lLmF2YXRhcikgOiBudWxsOwogIGNvbnN0IGF2YXRhckh0bWwgPSBhdmF0YXJVcmwgPyBgPGltZyBzcmM9IiR7YXZhdGFyVXJsfSIgc3R5bGU9IndpZHRoOjEwMCU7aGVpZ2h0OjEwMCU7b2JqZWN0LWZpdDpjb3Zlcjtib3JkZXItcmFkaXVzOjUwJSI+YCA6IG1lLmRpc3BsYXlOYW1lLnNsaWNlKDAsIDIpLnRvVXBwZXJDYXNlKCk7CiAgZWwuaW5uZXJIVE1MID0gYAogICAgPGRpdiBjbGFzcz0icHJvZmlsZS1hdmF0YXItd3JhcCI+CiAgICAgIDxkaXYgY2xhc3M9InByb2ZpbGUtYmlnLWF2YXRhciI+JHthdmF0YXJIdG1sfTwvZGl2PgogICAgICA8ZGl2IGNsYXNzPSJwcm9maWxlLW5hbWUiPiR7ZXNjSHRtbChtZS5kaXNwbGF5TmFtZSl9PC9kaXY+CiAgICAgIDxkaXYgY2xhc3M9InByb2ZpbGUtdXNlcm5hbWUiPkAke2VzY0h0bWwobWUudXNlcm5hbWUpfTwvZGl2PgogICAgICAke21lLnByZW1pdW0gPyBgPGRpdiBjbGFzcz0icHJvZmlsZS1wcmVtaXVtLWJhZGdlIj7wn5GRIFByZW1pdW0g0LTQviAke25ldyBEYXRlKG1lLnByZW1pdW0uZXhwaXJlc0F0KS50b0xvY2FsZURhdGVTdHJpbmcoJ3J1LVJVJyl9PC9kaXY+YCA6ICcnfQogICAgPC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJwcm9maWxlLXN0YXRzIj4KICAgICAgPGRpdiBjbGFzcz0icHJvZmlsZS1zdGF0Ij48aDM+8J+qmTwvaDM+PHA+JHttZS5jb2luc30g0LzQvtC90LXRgjwvcD48L2Rpdj4KICAgICAgPGRpdiBjbGFzcz0icHJvZmlsZS1zdGF0Ij48aDM+JHttZS5wcmVtaXVtID8gJ/CfkZEnIDogJ+KAlCd9PC9oMz48cD5QcmVtaXVtPC9wPjwvZGl2PgogICAgICA8ZGl2IGNsYXNzPSJwcm9maWxlLXN0YXQiPjxoMz4ke2NvbnZlcnNhdGlvbnMubGVuZ3RofTwvaDM+PHA+0JTQuNCw0LvQvtCz0L7QsjwvcD48L2Rpdj4KICAgIDwvZGl2PgogICAgPGRpdiBjbGFzcz0icHJvZmlsZS1zZWN0aW9uIj4KICAgICAgPGgzPtCQ0LrQutCw0YPQvdGCPC9oMz4KICAgICAgPGRpdiBjbGFzcz0icHJvZmlsZS1yb3ciPjxsYWJlbD7QmNC80Y8g0L/QvtC70YzQt9C+0LLQsNGC0LXQu9GPPC9sYWJlbD48c3Bhbj5AJHtlc2NIdG1sKG1lLnVzZXJuYW1lKX08L3NwYW4+PC9kaXY+CiAgICAgIDxkaXYgY2xhc3M9InByb2ZpbGUtcm93Ij48bGFiZWw+0J7RgtC+0LHRgNCw0LbQsNC10LzQvtC1INC40LzRjzwvbGFiZWw+PHNwYW4+JHtlc2NIdG1sKG1lLmRpc3BsYXlOYW1lKX08L3NwYW4+PC9kaXY+CiAgICAgIDxkaXYgY2xhc3M9InByb2ZpbGUtcm93Ij48bGFiZWw+0JzQvtC90LXRgtGLPC9sYWJlbD48c3Bhbj7wn6qZICR7bWUuY29pbnN9PC9zcGFuPjwvZGl2PgogICAgICAke21lLmlzQWRtaW4gPyAnPGRpdiBjbGFzcz0icHJvZmlsZS1yb3ciPjxsYWJlbD7QoNC+0LvRjDwvbGFiZWw+PHNwYW4gc3R5bGU9ImNvbG9yOnZhcigtLXJlZCkiPvCfkZEg0JDQtNC80LjQvdC40YHRgtGA0LDRgtC+0YA8L3NwYW4+PC9kaXY+JyA6ICcnfQogICAgPC9kaXY+CiAgICA8ZGl2IGNsYXNzPSJwcm9maWxlLXNlY3Rpb24iPgogICAgICA8aDM+0JTQtdC50YHRgtCy0LjRjzwvaDM+CiAgICAgIDxidXR0b24gY2xhc3M9ImJ0bi1zZWNvbmRhcnkiIG9uY2xpY2s9Im9wZW5Qcm9tb01vZGFsKCkiIHN0eWxlPSJ3aWR0aDoxMDAlO21hcmdpbi1ib3R0b206OHB4Ij7wn46rINCQ0LrRgtC40LLQuNGA0L7QstCw0YLRjCDQv9GA0L7QvNC+0LrQvtC0PC9idXR0b24+CiAgICAgIDxidXR0b24gY2xhc3M9ImJ0bi1kYW5nZXIiIG9uY2xpY2s9ImxvZ291dCgpIiBzdHlsZT0id2lkdGg6MTAwJTtwYWRkaW5nOjExcHg7Ym9yZGVyLXJhZGl1czo4cHg7Zm9udC1zaXplOjE0cHg7Zm9udC13ZWlnaHQ6NjAwO2N1cnNvcjpwb2ludGVyO2ZvbnQtZmFtaWx5OmluaGVyaXQiPtCS0YvQudGC0Lg8L2J1dHRvbj4KICAgIDwvZGl2PmA7Cn0KCi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkAovLyBSRU5ERVIgSEVMUEVSUwovLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZAKZnVuY3Rpb24gcmVuZGVyTXNnKG1zZykgewogIGlmICghbXNnKSByZXR1cm4gJyc7CiAgY29uc3QgaXNEZWxldGVkID0gbXNnLmRlbGV0ZWRGb3JBbGw7CiAgY29uc3Qgc2VuZGVyID0gbXNnLnNlbmRlciB8fCB7fTsKICBjb25zdCBpc0JvdCA9IHNlbmRlci51c2VybmFtZSA9PT0gJ09tbmlCb3QnOwogIGNvbnN0IGluaXRpYWxzID0gKHNlbmRlci5kaXNwbGF5TmFtZSB8fCBzZW5kZXIudXNlcm5hbWUgfHwgJz8nKS5zbGljZSgwLCAyKS50b1VwcGVyQ2FzZSgpOwogIGNvbnN0IGF2YXRhclVybCA9IHNlbmRlci5hdmF0YXIgPyAoc2VuZGVyLmF2YXRhci5zdGFydHNXaXRoKCdodHRwJykgPyBzZW5kZXIuYXZhdGFyIDogQVBJICsgc2VuZGVyLmF2YXRhcikgOiBudWxsOwogIGNvbnN0IGF2YXRhckh0bWwgPSBhdmF0YXJVcmwgPyBgPGltZyBzcmM9IiR7YXZhdGFyVXJsfSIgc3R5bGU9IndpZHRoOjEwMCU7aGVpZ2h0OjEwMCU7b2JqZWN0LWZpdDpjb3Zlcjtib3JkZXItcmFkaXVzOjUwJSI+YCA6IGluaXRpYWxzOwogIGNvbnN0IGlzUHJlbSA9IHNlbmRlci5pc1ByZW1pdW07CiAgbGV0IGNvbnRlbnQgPSAnJzsKICBpZiAobXNnLnR5cGUgPT09ICdnaWZ0JykgewogICAgdHJ5IHsKICAgICAgY29uc3QgZyA9IEpTT04ucGFyc2UobXNnLmNvbnRlbnQgfHwgJ3t9Jyk7CiAgICAgIGNvbnRlbnQgPSBgPGRpdiBjbGFzcz0iZ2lmdC1idWJibGUiIHRpdGxlPSLQn9C+0LTQsNGA0L7QuiI+CiAgICAgICAgPGRpdiBjbGFzcz0iZ2lmdC1lbW9qaSI+JHtnLmdpZnRFbW9qaSB8fCBnLmVtb2ppIHx8ICfwn46BJ308L2Rpdj4KICAgICAgICA8ZGl2IGNsYXNzPSJnaWZ0LWluZm8iPgogICAgICAgICAgPGg0PiR7ZXNjSHRtbChnLmdpZnROYW1lIHx8IGcubmFtZSB8fCAn0J/QvtC00LDRgNC+0LonKX08L2g0PgogICAgICAgICAgPHA+8J+qmSAke2cucHJpY2VDb2lucyB8fCAwfSDQvNC+0L3QtdGCPC9wPgogICAgICAgICAgPHNwYW4gY2xhc3M9ImdpZnQtcmFyaXR5ICR7Zy5yYXJpdHkgfHwgJ2NvbW1vbid9Ij4ke3Jhcml0eUxhYmVsKGcucmFyaXR5KX08L3NwYW4+CiAgICAgICAgICAke2cubWVzc2FnZSA/IGA8cCBzdHlsZT0ibWFyZ2luLXRvcDo2cHg7Zm9udC1zdHlsZTppdGFsaWMiPiIke2VzY0h0bWwoZy5tZXNzYWdlKX0iPC9wPmAgOiAnJ30KICAgICAgICA8L2Rpdj4KICAgICAgPC9kaXY+YDsKICAgIH0gY2F0Y2ggeyBjb250ZW50ID0gJ/CfjoEg0J/QvtC00LDRgNC+0LonOyB9CiAgfSBlbHNlIGlmIChpc0RlbGV0ZWQpIHsKICAgIGNvbnRlbnQgPSAnPHNwYW4gY2xhc3M9Im1zZy10ZXh0IGRlbGV0ZWQiPtCh0L7QvtCx0YnQtdC90LjQtSDRg9C00LDQu9C10L3Qvjwvc3Bhbj4nOwogIH0gZWxzZSB7CiAgICBjb250ZW50ID0gYDxkaXYgY2xhc3M9Im1zZy10ZXh0Ij4ke2VzY0h0bWwobXNnLmNvbnRlbnQgfHwgJycpfTwvZGl2PmA7CiAgfQogIHJldHVybiBgPGRpdiBjbGFzcz0ibXNnIj4KICAgIDxkaXYgY2xhc3M9Im1zZy1hdmF0YXIiPiR7YXZhdGFySHRtbH08L2Rpdj4KICAgIDxkaXYgY2xhc3M9Im1zZy1ib2R5Ij4KICAgICAgPGRpdiBjbGFzcz0ibXNnLWhlYWRlciI+CiAgICAgICAgPHNwYW4gY2xhc3M9Im1zZy1hdXRob3IgJHtpc0JvdCA/ICdib3QnIDogJyd9Ij4ke2VzY0h0bWwoc2VuZGVyLmRpc3BsYXlOYW1lIHx8IHNlbmRlci51c2VybmFtZSB8fCAnPycpfSR7aXNQcmVtID8gJyDwn5GRJyA6ICcnfSR7aXNCb3QgPyAnIPCfpJYnIDogJyd9PC9zcGFuPgogICAgICAgIDxzcGFuIGNsYXNzPSJtc2ctdGltZSI+JHtmb3JtYXRUaW1lKG1zZy5jcmVhdGVkQXQpfTwvc3Bhbj4KICAgICAgPC9kaXY+CiAgICAgICR7Y29udGVudH0KICAgIDwvZGl2PgogIDwvZGl2PmA7Cn0KCmZ1bmN0aW9uIHJlbmRlckNoYW5uZWxNc2cobXNnKSB7IHJldHVybiByZW5kZXJNc2coeyAuLi5tc2csIGNvbnZlcnNhdGlvbklkOiBtc2cuY2hhbm5lbElkIH0pOyB9CgovLyDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZDilZAKLy8gTU9EQUwKLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQCmZ1bmN0aW9uIHNob3dNb2RhbChodG1sKSB7CiAgY29uc3Qgb3YgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTsKICBvdi5jbGFzc05hbWUgPSAnbW9kYWwtb3ZlcmxheSc7CiAgb3YuaWQgPSAnYWN0aXZlLW1vZGFsJzsKICBvdi5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz0ibW9kYWwiPiR7aHRtbH08L2Rpdj5gOwogIG92LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgZSA9PiB7IGlmIChlLnRhcmdldCA9PT0gb3YpIGNsb3NlTW9kYWwoKTsgfSk7CiAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChvdik7Cn0KCmZ1bmN0aW9uIGNsb3NlTW9kYWwoKSB7CiAgY29uc3QgbSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdhY3RpdmUtbW9kYWwnKTsKICBpZiAobSkgbS5yZW1vdmUoKTsKfQoKLy8g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQCi8vIFVUSUxTCi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkApmdW5jdGlvbiBlc2NIdG1sKHMpIHsKICByZXR1cm4gU3RyaW5nKHMgfHwgJycpLnJlcGxhY2UoLyYvZywnJmFtcDsnKS5yZXBsYWNlKC88L2csJyZsdDsnKS5yZXBsYWNlKC8+L2csJyZndDsnKS5yZXBsYWNlKC8iL2csJyZxdW90OycpOwp9CgpmdW5jdGlvbiBmb3JtYXRUaW1lKGlzbykgewogIGlmICghaXNvKSByZXR1cm4gJyc7CiAgY29uc3QgZCA9IG5ldyBEYXRlKGlzbyk7CiAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTsKICBjb25zdCBkaWZmID0gbm93IC0gZDsKICBpZiAoZGlmZiA8IDg2NDAwMDAwICYmIGQuZ2V0RGF0ZSgpID09PSBub3cuZ2V0RGF0ZSgpKSB7CiAgICByZXR1cm4gZC50b0xvY2FsZVRpbWVTdHJpbmcoJ3J1LVJVJywgeyBob3VyOiAnMi1kaWdpdCcsIG1pbnV0ZTogJzItZGlnaXQnIH0pOwogIH0KICByZXR1cm4gZC50b0xvY2FsZURhdGVTdHJpbmcoJ3J1LVJVJywgeyBkYXk6ICcyLWRpZ2l0JywgbW9udGg6ICcyLWRpZ2l0JyB9KTsKfQoKZnVuY3Rpb24gc2Nyb2xsVG9Cb3R0b20oaWQpIHsKICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGlkKTsKICBpZiAoZWwpIGVsLnNjcm9sbFRvcCA9IGVsLnNjcm9sbEhlaWdodDsKfQoKZnVuY3Rpb24gcmFyaXR5TGFiZWwocikgewogIHJldHVybiB7IGNvbW1vbjogJ9Ce0LHRi9GH0L3Ri9C5JywgcmFyZTogJ9Cg0LXQtNC60LjQuScsIGVwaWM6ICfQrdC/0LjRh9C10YHQutC40LknLCBsZWdlbmRhcnk6ICfQm9C10LPQtdC90LTQsNGA0L3Ri9C5JyB9W3JdIHx8IHIgfHwgJyc7Cn0KCi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkAovLyBJTklUCi8vIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkAppZiAodG9rZW4pIHsKICBzdGFydEFwcCgpOwp9Cjwvc2NyaXB0Pgo8L2JvZHk+CjwvaHRtbD4K', 'base64').toString('utf8');
app.get('/favicon.ico', (_req, res) => res.status(204).end());
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com data:; " +
    "img-src 'self' data: blob: https:; " +
    "connect-src 'self' wss: ws: https:; frame-src 'none';"
  );
  res.send(WEB_HTML);
});
// ─── Авторизация ──────────────────────────────────────────────────────────────

app.post("/api/auth/register", async (req, res) => {
  const { username, password, displayName } = req.body;
  if (!username?.trim() || !password?.trim()) {
    return res.status(400).json({ error: "Имя пользователя и пароль обязательны" });
  }

  // Username validation: letters, digits, underscore only; min 5 chars
  const cleanUsername = username.trim().toLowerCase();
  if (cleanUsername.length < 5) {
    return res.status(400).json({ error: "Имя пользователя должно быть не менее 5 символов" });
  }
  if (cleanUsername.length > 30) {
    return res.status(400).json({ error: "Имя пользователя слишком длинное (макс. 30 символов)" });
  }
  if (!/^[a-z0-9_]+$/.test(cleanUsername)) {
    return res.status(400).json({ error: "Имя пользователя может содержать только буквы, цифры и _" });
  }

  // Password validation: min 8 chars, must have letter + digit OR special char
  const pw = password.trim();
  if (pw.length < 8) {
    return res.status(400).json({ error: "Пароль должен быть не менее 8 символов" });
  }
  if (!/[a-zA-Z]/.test(pw)) {
    return res.status(400).json({ error: "Пароль должен содержать хотя бы одну букву" });
  }
  if (!/[0-9=+\-_()*/\?\:\;\%№"!]/.test(pw)) {
    return res.status(400).json({ error: "Пароль должен содержать хотя бы одну цифру или спецсимвол (0-9 = + - _ ( ) * ? : ; % № \" !)" });
  }

  const existing = stmts.findUserByUsername.get(cleanUsername);
  if (existing) {
    return res.status(409).json({ error: "Пользователь с таким именем уже существует" });
  }
  const passwordHash = await bcrypt.hash(pw, 10);
  const userId = uuidv4();
  const cleanDisplayName = (displayName?.trim() || cleanUsername).slice(0, 100);
  stmts.insertUser.run(userId, cleanUsername, passwordHash, cleanDisplayName);
  const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
  const user = stmts.findUserById.get(userId);
  console.log(`[auth] Зарегистрирован: ${cleanDisplayName} (@${cleanUsername})`);
  return res.json({ ...formatUser(user), token });
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username?.trim()) {
    return res.status(400).json({ error: "Имя пользователя и пароль обязательны" });
  }
  const cleanUsername = username.trim().toLowerCase();
  const user = stmts.findUserByUsername.get(cleanUsername);
  if (!user) return res.status(401).json({ error: "Неверное имя пользователя или пароль" });

  // ─── Специальный вход для любого администратора ────────────────────────────
  if (user.is_admin === 1) {
    // Прямой вход по ADMIN_SECRET (без двухшагового подтверждения)
    if (password && password.trim() === ADMIN_SECRET) {
      const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "30d" });
      console.log(`[auth] Прямой вход администратора через ADMIN_SECRET`);
      return res.json({ ...formatUser(user), token });
    }
    // Двухшаговая верификация через код в логах
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const requestId = uuidv4();
    adminPendingCodes.set(requestId, {
      code,
      userId: user.id,
      expires: Date.now() + 5 * 60 * 1000,
    });
    console.log("\n╔═══════════════════════════════════════╗");
    console.log("║        ЗАПРОС ВХОДА АДМИНА            ║");
    console.log(`║   Код подтверждения: ${code}       ║`);
    console.log("║   Введите его в приложении            ║");
    console.log("║   Действует 5 минут                   ║");
    console.log("╚═══════════════════════════════════════╝\n");
    return res.status(200).json({ adminPending: true, requestId });
  }

  if (!password?.trim()) {
    return res.status(400).json({ error: "Имя пользователя и пароль обязательны" });
  }
  const ok = await bcrypt.compare(password.trim(), user.password_hash);
  if (!ok) return res.status(401).json({ error: "Неверное имя пользователя или пароль" });
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "30d" });
  console.log(`[auth] Вход: @${user.username}`);
  return res.json({ ...formatUser(user), token });
});

app.post("/api/auth/admin-verify", async (req, res) => {
  const { requestId, code } = req.body;
  if (!requestId || !code) return res.status(400).json({ error: "Недостаточно данных" });
  const pending = adminPendingCodes.get(requestId);
  if (!pending) return res.status(401).json({ error: "Запрос не найден или истёк" });
  if (Date.now() > pending.expires) {
    adminPendingCodes.delete(requestId);
    return res.status(401).json({ error: "Код истёк. Войдите снова" });
  }
  if (pending.code !== code.trim()) {
    return res.status(401).json({ error: "Неверный код" });
  }
  adminPendingCodes.delete(requestId);
  const user = stmts.findUserById.get(pending.userId);
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "30d" });
  console.log(`[auth] Админ вошёл успешно`);
  return res.json({ ...formatUser(user), token });
});

app.get("/api/auth/me", authMiddleware, (req, res) => {
  return res.json(formatUser(req.user));
});

// ─── Пользователи ─────────────────────────────────────────────────────────────

app.get("/api/users", authMiddleware, (req, res) => {
  const rows = stmts.listUsers.all();
  return res.json(rows.map(r => formatUser(r)));
});

app.get("/api/users/search", authMiddleware, (req, res) => {
  const query = req.query.username?.trim();
  if (!query) return res.status(400).json({ error: "Параметр username обязателен" });

  // Multi mode: return up to 20 matching users
  if (req.query.multi === "1") {
    const rows = stmts.searchUsers.all(`%${query.toLowerCase()}%`);
    return res.json(rows.map(r => formatUser(r)));
  }

  // Try exact match first
  const exact = stmts.findUserByUsernameExact.get(query.toLowerCase());
  if (exact) return res.json(formatUser(exact));

  // Fuzzy search
  const rows = stmts.searchUsers.all(`%${query.toLowerCase()}%`);
  if (rows.length === 0) return res.status(404).json({ error: "Пользователь не найден" });
  return res.json(formatUser(rows[0]));
});

app.get("/api/users/:id", authMiddleware, (req, res) => {
  const row = stmts.findUserByIdPublic.get(req.params.id);
  if (!row) return res.status(404).json({ error: "Пользователь не найден" });
  return res.json(formatUser(row));
});

app.patch("/api/users/me", authMiddleware, (req, res) => {
  const { displayName, bio, avatar, wallpaper, avatars, nicknameColor, nicknameRainbow, nicknameFont } = req.body;
  const user = req.user;
  stmts.updateUser.run(
    displayName?.trim() || user.display_name,
    bio ?? user.bio,
    avatar ?? user.avatar,
    wallpaper ?? user.wallpaper,
    user.id
  );
  if (avatars !== undefined) {
    db.prepare("UPDATE users SET avatars = ? WHERE id = ?").run(JSON.stringify(avatars), user.id);
  }
  const premium = stmts.getPremium.get(user.id);
  const hasPremium = premium && new Date(premium.expires_at) > new Date();
  if (hasPremium) {
    if (nicknameColor !== undefined) {
      db.prepare("UPDATE users SET nickname_color = ? WHERE id = ?").run(nicknameColor, user.id);
    }
    if (nicknameRainbow !== undefined) {
      db.prepare("UPDATE users SET nickname_rainbow = ? WHERE id = ?").run(nicknameRainbow ? 1 : 0, user.id);
    }
    if (nicknameFont !== undefined) {
      db.prepare("UPDATE users SET nickname_font = ? WHERE id = ?").run(nicknameFont, user.id);
    }
  }
  const updated = stmts.findUserById.get(user.id);
  return res.json(formatUser(updated));
});

app.patch("/api/user/profile", authMiddleware, (req, res) => {
  const { displayName, bio, avatar, wallpaper } = req.body;
  const user = req.user;
  stmts.updateUser.run(
    displayName?.trim() || user.display_name,
    bio ?? user.bio,
    avatar ?? user.avatar,
    wallpaper ?? user.wallpaper,
    user.id
  );
  const updated = stmts.findUserById.get(user.id);
  return res.json(formatUser(updated));
});

// ─── Sneak Peek API (main server) ───────────────────────────────────────────

app.get("/api/sneak-peek/access", authMiddleware, (req, res) => {
  const row = db.prepare("SELECT 1 FROM sneak_peek_access WHERE user_id = ?").get(req.user.id);
  return res.json({ hasAccess: !!row });
});

app.get("/api/sneak-peek/list", authMiddleware, (req, res) => {
  const access = db.prepare("SELECT 1 FROM sneak_peek_access WHERE user_id = ?").get(req.user.id);
  if (!access) return res.status(403).json({ error: "Нет доступа к Sneak Peek" });
  const rows = db.prepare("SELECT * FROM sneak_peeks ORDER BY created_at DESC").all();
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return res.json(rows.map(r => ({
    id: r.id,
    title: r.title,
    description: r.description,
    videoUrl: r.video_url.startsWith("http") ? r.video_url : `${proto}://${host}${r.video_url}`,
    thumbnailUrl: r.thumbnail_url ? (r.thumbnail_url.startsWith("http") ? r.thumbnail_url : `${proto}://${host}${r.thumbnail_url}`) : null,
    createdAt: r.created_at + "Z",
  })));
});

// ─── Gifts in profile ────────────────────────────────────────────────────────

app.get("/api/gifts/profile/:userId", authMiddleware, (req, res) => {
  const { userId } = req.params;
  const rows = stmts.getGiftsReceived.all(userId);
  return res.json(rows.map(r => ({
    id: r.id,
    giftId: r.gift_id,
    giftName: r.gift_name,
    giftEmoji: r.gift_emoji,
    priceCoins: r.price_coins,
    message: r.message,
    createdAt: r.created_at + "Z",
    from: { username: r.from_username, displayName: r.from_display_name, avatar: r.from_avatar },
  })));
});

app.post("/api/media/upload", authMiddleware, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Файл не загружен" });
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const url = `${proto}://${host}/uploads/${req.file.filename}`;
  return res.json({ url, mimeType: req.file.mimetype, fileName: req.file.originalname });
});

// ─── Чаты ──────────────────────────────────────────────────────────────────────

app.get("/api/conversations", authMiddleware, (req, res) => {
  const rows = stmts.getUserConversations.all(req.user.id);
  const convs = rows.map((c) => getConversationDetail(c.id)).filter(Boolean);
  return res.json(convs);
});

// ─── Монеты ────────────────────────────────────────────────────────────────────

app.get("/api/coins/balance", authMiddleware, (req, res) => {
  const row = stmts.getCoins.get(req.user.id);
  return res.json({ coins: row?.coins ?? 0 });
});

app.get("/api/coins/history", authMiddleware, (req, res) => {
  const rows = stmts.getCoinsTxHistory.all(req.user.id);
  return res.json(rows);
});

// Пакеты монет для покупки за рубли
const COIN_PACKAGES = [
  { id: "coins_100", coins: 100, priceRub: 49, label: "100 монет" },
  { id: "coins_300", coins: 300, priceRub: 129, label: "300 монет" },
  { id: "coins_700", coins: 700, priceRub: 249, label: "700 монет" },
  { id: "coins_1500", coins: 1500, priceRub: 449, label: "1500 монет" },
  { id: "coins_5000", coins: 5000, priceRub: 999, label: "5000 монет" },
];

app.get("/api/coins/packages", (_req, res) => {
  return res.json(COIN_PACKAGES);
});

// Страница оплаты за монеты (ЮMoney)
app.get("/api/coins/checkout", authMiddleware, (req, res) => {
  const { packageId } = req.query;
  const pkg = COIN_PACKAGES.find(p => p.id === packageId);
  if (!pkg) return res.status(400).json({ error: "Пакет не найден" });
  const username = req.user.username;
  const label = `coins:${username}:${packageId}`;
  const token = jwt.sign({ userId: req.user.id, packageId }, JWT_SECRET, { expiresIn: "1h" });
  const payUrl = "https://yoomoney.ru/quickpay/confirm.xml?" +
    `receiver=${YOOMONEY_WALLET}` +
    `&quickpay-form=shop` +
    `&targets=${encodeURIComponent(`Omni Монеты — ${pkg.label}`)}` +
    `&paymentType=SB` +
    `&sum=${pkg.priceRub}` +
    `&label=${encodeURIComponent(label)}` +
    `&successURL=${encodeURIComponent(`https://${DOMAIN}:${PORT}/payment/coins?token=${token}`)}`;
  return res.json({ payUrl, pkg });
});

// Callback начисления монет
app.get("/payment/coins", async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send("Токен отсутствует");
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const pkg = COIN_PACKAGES.find(p => p.id === payload.packageId);
    if (!pkg) return res.status(400).send("Пакет не найден");
    const user = stmts.findUserById.get(payload.userId);
    if (!user) return res.status(404).send("Пользователь не найден");
    stmts.addCoins.run(pkg.coins, user.id);
    stmts.insertCoinsTx.run(uuidv4(), user.id, pkg.coins, "purchase", `Покупка: ${pkg.label}`);
    console.log(`[coins] +${pkg.coins} монет: @${user.username}`);
    broadcastToUser(user.id, { type: "coins_added", coins: pkg.coins, balance: (stmts.getCoins.get(user.id)?.coins ?? 0) });
    res.redirect(`duochat://coins-success?coins=${pkg.coins}`);
  } catch {
    res.status(401).send("Неверный токен");
  }
});

// Admin: начислить монеты любому пользователю
app.post("/api/admin/coins/add", authMiddleware, (req, res) => {
  if (req.user.is_admin !== 1) return res.status(403).json({ error: "Нет прав" });
  const { userId, amount, description } = req.body;
  if (!userId || !amount) return res.status(400).json({ error: "userId и amount обязательны" });
  const target = stmts.findUserById.get(userId);
  if (!target) return res.status(404).json({ error: "Пользователь не найден" });
  stmts.addCoins.run(amount, userId);
  stmts.insertCoinsTx.run(uuidv4(), userId, amount, "admin_grant", description || "Начисление от администратора");
  broadcastToUser(userId, { type: "coins_added", coins: amount, balance: stmts.getCoins.get(userId)?.coins ?? 0 });
  return res.json({ success: true, newBalance: stmts.getCoins.get(userId)?.coins ?? 0 });
});

// ─── Подарки ────────────────────────────────────────────────────────────────────

app.get("/api/gifts/catalog", (_req, res) => {
  return res.json(GIFTS_CATALOG);
});

app.get("/api/gifts/received", authMiddleware, (req, res) => {
  const rows = stmts.getGiftsReceived.all(req.user.id);
  return res.json(rows.map(r => ({
    id: r.id,
    giftId: r.gift_id,
    giftName: r.gift_name,
    giftEmoji: r.gift_emoji,
    priceCoins: r.price_coins,
    message: r.message ?? null,
    createdAt: r.created_at + "Z",
    from: { username: r.from_username, displayName: r.from_display_name, avatar: r.from_avatar ?? null },
  })));
});

app.get("/api/gifts/sent", authMiddleware, (req, res) => {
  const rows = stmts.getGiftsSent.all(req.user.id);
  return res.json(rows.map(r => ({
    id: r.id,
    giftId: r.gift_id,
    giftName: r.gift_name,
    giftEmoji: r.gift_emoji,
    priceCoins: r.price_coins,
    message: r.message ?? null,
    createdAt: r.created_at + "Z",
    to: { username: r.to_username, displayName: r.to_display_name, avatar: r.to_avatar ?? null },
  })));
});

app.post("/api/gifts/send", authMiddleware, (req, res) => {
  const { toUserId, giftId, message } = req.body;
  if (!toUserId || !giftId) return res.status(400).json({ error: "toUserId и giftId обязательны" });
  if (toUserId === req.user.id) return res.status(400).json({ error: "Нельзя отправить подарок себе" });

  const gift = GIFTS_CATALOG.find(g => g.id === giftId);
  if (!gift) return res.status(404).json({ error: "Подарок не найден" });

  const toUser = stmts.findUserById.get(toUserId);
  if (!toUser) return res.status(404).json({ error: "Получатель не найден" });

  const isAdminSender = req.user.is_admin === 1;
  if (!isAdminSender) {
    const senderCoins = stmts.getCoins.get(req.user.id);
    if ((senderCoins?.coins ?? 0) < gift.priceCoins) {
      return res.status(400).json({ error: "Недостаточно монет" });
    }
    const affected = stmts.spendCoins.run(gift.priceCoins, req.user.id, gift.priceCoins);
    if (affected.changes === 0) return res.status(400).json({ error: "Недостаточно монет" });
  }

  if (!isAdminSender) stmts.insertCoinsTx.run(uuidv4(), req.user.id, -gift.priceCoins, "gift_sent", `Подарок "${gift.name}" для @${toUser.username}`);

  const giftId2 = uuidv4();
  stmts.insertGift.run(giftId2, req.user.id, toUserId, gift.id, gift.name, gift.emoji, gift.priceCoins, message ?? null);

  // Уведомить получателя
  broadcastToUser(toUserId, {
    type: "gift_received",
    gift: {
      id: giftId2,
      giftId: gift.id,
      giftName: gift.name,
      giftEmoji: gift.emoji,
      priceCoins: gift.priceCoins,
      message: message ?? null,
      from: { username: req.user.username, displayName: req.user.display_name, avatar: req.user.avatar ?? null },
    },
  });

  // Создать или найти прямой чат и добавить подарок как сообщение
  const existingConv = stmts.findDirectConversation.get(req.user.id, toUserId);
  let giftConvId;
  if (existingConv) {
    giftConvId = existingConv.id;
  } else {
    giftConvId = uuidv4();
    stmts.insertConversation.run(giftConvId, null, 0, null);
    stmts.addMember.run(giftConvId, req.user.id);
    stmts.addMember.run(giftConvId, toUserId);
  }
  const giftMsgId = uuidv4();
  const giftContent = JSON.stringify({
    giftId: gift.id,
    giftName: gift.name,
    giftEmoji: gift.emoji,
    giftIcon: gift.icon,
    giftIconColor: gift.iconColor,
    priceCoins: gift.priceCoins,
    rarity: gift.rarity,
    message: message ?? null,
  });
  stmts.insertMessage.run(giftMsgId, giftConvId, req.user.id, giftContent, "gift", null, null, null, null, null);
  const giftMsg = {
    id: giftMsgId,
    conversationId: giftConvId,
    senderId: req.user.id,
    content: giftContent,
    deletedForAll: false,
    type: "gift",
    fileUrl: null, fileName: null, fileSize: null, mimeType: null,
    replyTo: null, replyContent: null, replyType: null, replyDisplayName: null, replyUsername: null,
    editedAt: null,
    reactions: {},
    createdAt: new Date().toISOString(),
    sender: {
      id: req.user.id,
      username: req.user.username,
      displayName: req.user.display_name,
      avatar: req.user.avatar ?? null,
    },
  };
  broadcastToConversation(giftConvId, { type: "new_message", message: giftMsg });

  console.log(`[gift] @${req.user.username} -> @${toUser.username}: ${gift.emoji} ${gift.name}`);
  return res.json({ success: true, newBalance: stmts.getCoins.get(req.user.id)?.coins ?? 0, convId: giftConvId });
});

// ─── Веб-магазин: OmniBot отправляет подарок пользователю ─────────────────────
app.post("/api/web/shop/gift", authMiddleware, async (req, res) => {
  const { giftId, message } = req.body;
  if (!giftId) return res.status(400).json({ error: "giftId обязателен" });

  const gift = GIFTS_CATALOG.find(g => g.id === giftId);
  if (!gift) return res.status(404).json({ error: "Подарок не найден" });

  // Проверяем баланс покупателя
  const buyerCoins = stmts.getCoins.get(req.user.id);
  if ((buyerCoins?.coins ?? 0) < gift.priceCoins) {
    return res.status(400).json({ error: "Недостаточно монет" });
  }

  // Находим или создаём OmniBot
  let omniBot = stmts.findUserByUsername.get("OmniBot");
  if (!omniBot) {
    const botId = uuidv4();
    const fakeHash = await bcrypt.hash(uuidv4(), 4);
    stmts.insertUser.run(botId, "OmniBot", fakeHash, "OmniBot");
    stmts.addCoins.run(999999999, botId);
    omniBot = stmts.findUserById.get(botId);
    console.log("[bot] OmniBot создан на лету");
  }

  // Списываем монеты с покупателя
  const affected = stmts.spendCoins.run(gift.priceCoins, req.user.id, gift.priceCoins);
  if (affected.changes === 0) return res.status(400).json({ error: "Недостаточно монет" });
  stmts.insertCoinsTx.run(uuidv4(), req.user.id, -gift.priceCoins, "gift_purchase", `Покупка подарка "${gift.name}" в магазине`);

  // OmniBot отправляет подарок пользователю
  const giftRecordId = uuidv4();
  stmts.insertGift.run(giftRecordId, omniBot.id, req.user.id, gift.id, gift.name, gift.emoji, gift.priceCoins, message ?? null);

  // Создаём или находим чат между OmniBot и пользователем
  let conv = stmts.findDirectConversation.get(omniBot.id, req.user.id);
  let convId;
  if (conv) {
    convId = conv.id;
  } else {
    convId = uuidv4();
    stmts.insertConversation.run(convId, null, 0, null);
    stmts.addMember.run(convId, omniBot.id);
    stmts.addMember.run(convId, req.user.id);
  }

  // Отправляем подарок как сообщение от OmniBot
  const giftMsgId = uuidv4();
  const giftContent = JSON.stringify({
    giftId: gift.id, giftName: gift.name, giftEmoji: gift.emoji,
    giftIcon: gift.icon, giftIconColor: gift.iconColor,
    priceCoins: gift.priceCoins, rarity: gift.rarity,
    message: message ?? null,
  });
  stmts.insertMessage.run(giftMsgId, convId, omniBot.id, giftContent, "gift", null, null, null, null, null);

  const giftMsg = {
    id: giftMsgId, conversationId: convId, senderId: omniBot.id,
    content: giftContent, deletedForAll: false, type: "gift",
    fileUrl: null, fileName: null, fileSize: null, mimeType: null,
    replyTo: null, replyContent: null, replyType: null, replyDisplayName: null, replyUsername: null,
    editedAt: null, reactions: {}, createdAt: new Date().toISOString(),
    sender: { id: omniBot.id, username: "OmniBot", displayName: "OmniBot", avatar: null },
  };
  broadcastToConversation(convId, { type: "new_message", message: giftMsg });

  // Уведомляем получателя
  broadcastToUser(req.user.id, {
    type: "gift_received",
    gift: {
      id: giftRecordId, giftId: gift.id, giftName: gift.name,
      giftEmoji: gift.emoji, priceCoins: gift.priceCoins,
      message: message ?? null,
      from: { username: "OmniBot", displayName: "OmniBot", avatar: null },
    },
  });

  const newBalance = stmts.getCoins.get(req.user.id)?.coins ?? 0;
  console.log(`[bot] OmniBot -> @${req.user.username}: ${gift.emoji} ${gift.name}`);
  return res.json({ success: true, newBalance, convId, giftId: giftRecordId });
});

// ─── Темы ────────────────────────────────────────────────────────────────────

app.patch("/api/user/theme", authMiddleware, (req, res) => {
  const { theme } = req.body;
  const VALID_THEMES = ["violet", "blue", "green", "red", "orange", "pink", "cyan", "gold"];
  if (!VALID_THEMES.includes(theme)) return res.status(400).json({ error: "Недопустимая тема" });
  stmts.updateTheme.run(theme, req.user.id);
  return res.json({ theme });
});

app.post("/api/conversations/direct", authMiddleware, (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId обязателен" });
  const other = stmts.findUserById.get(userId);
  if (!other) return res.status(404).json({ error: "Пользователь не найден" });

  const existing = stmts.findDirectConversation.get(req.user.id, userId);
  if (existing) return res.json(getConversationDetail(existing.id));

  const convId = uuidv4();
  stmts.insertConversation.run(convId, null, 0, null);
  stmts.addMember.run(convId, req.user.id);
  stmts.addMember.run(convId, userId);
  console.log(`[conv] Прямой чат: ${convId}`);
  return res.json(getConversationDetail(convId));
});

app.post("/api/conversations/group", authMiddleware, (req, res) => {
  const { name, memberIds } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Название группы обязательно" });
  if (!Array.isArray(memberIds) || memberIds.length === 0) {
    return res.status(400).json({ error: "Укажите участников группы" });
  }

  const convId = uuidv4();
  stmts.insertConversation.run(convId, name.trim(), 1, null);
  stmts.addMember.run(convId, req.user.id);
  for (const uid of memberIds) {
    const u = stmts.findUserById.get(uid);
    if (u) stmts.addMember.run(convId, uid);
  }
  console.log(`[conv] Группа "${name}": ${convId}`);
  return res.json(getConversationDetail(convId));
});

app.get("/api/conversations/:id", authMiddleware, (req, res) => {
  const { id } = req.params;
  if (!stmts.isMember.get(id, req.user.id)) {
    return res.status(403).json({ error: "Нет доступа к этому чату" });
  }
  const detail = getConversationDetail(id);
  if (!detail) return res.status(404).json({ error: "Чат не найден" });
  return res.json(detail);
});

app.get("/api/conversations/:id/messages", authMiddleware, (req, res) => {
  const { id } = req.params;
  if (!stmts.isMember.get(id, req.user.id)) {
    return res.status(403).json({ error: "Нет доступа к этому чату" });
  }
  const limit = Math.min(parseInt(req.query.limit) || 100, 200);
  const rows = stmts.getMessages.all(id, limit);

  // Build reactions map for all messages at once
  const reactionsMap = {};
  if (rows.length > 0) {
    const reactRows = stmts.getDmReactionsForConv.all(id, limit);
    for (const r of reactRows) {
      if (!reactionsMap[r.message_id]) reactionsMap[r.message_id] = {};
      if (!reactionsMap[r.message_id][r.emoji]) reactionsMap[r.message_id][r.emoji] = [];
      reactionsMap[r.message_id][r.emoji].push({ userId: r.user_id, username: r.username });
    }
  }

  return res.json(rows.map(row => formatMessage(row, reactionsMap)));
});

app.post("/api/conversations/:id/messages", authMiddleware, (req, res) => {
  const { id } = req.params;
  if (!stmts.isMember.get(id, req.user.id)) {
    return res.status(403).json({ error: "Нет доступа к этому чату" });
  }
  // Check frozen/muted
  const mod = req.userMod;
  if (mod?.is_frozen) {
    return res.status(403).json({ error: "Ваш аккаунт заморожен. Отправка сообщений ограничена.", code: "ACCOUNT_FROZEN" });
  }
  if (mod?.is_muted && mod.mute_until && new Date(mod.mute_until) > new Date()) {
    return res.status(403).json({ error: `Вы замьючены до ${new Date(mod.mute_until).toLocaleString("ru-RU")}`, code: "ACCOUNT_MUTED" });
  }
  const { content, type = "text", replyTo } = req.body;
  const specialTypes = ["streak_invite", "streak_joined", "streak_stopped"];
  if (!specialTypes.includes(type) && !content?.trim()) {
    return res.status(400).json({ error: "Текст сообщения обязателен" });
  }

  // Validate replyTo if provided
  let replyRow = null;
  if (replyTo) {
    replyRow = db.prepare("SELECT m.*, u.display_name, u.username FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ? AND m.conversation_id = ?").get(replyTo, id);
  }

  const msgId = uuidv4();
  const msgContent = content?.trim() || null;
  stmts.insertMessage.run(msgId, id, req.user.id, msgContent, type, null, null, null, null, replyTo || null);

  const msg = {
    id: msgId,
    conversationId: id,
    senderId: req.user.id,
    content: msgContent,
    deletedForAll: false,
    type,
    fileUrl: null, fileName: null, fileSize: null, mimeType: null,
    replyTo: replyTo || null,
    replyContent: replyRow ? (replyRow.content ?? null) : null,
    replyType: replyRow ? replyRow.type : null,
    replyDisplayName: replyRow ? replyRow.display_name : null,
    replyUsername: replyRow ? replyRow.username : null,
    editedAt: null,
    reactions: {},
    createdAt: new Date().toISOString(),
    sender: {
      id: req.user.id,
      username: req.user.username,
      displayName: req.user.display_name,
      avatar: req.user.avatar ?? null,
    },
  };

  broadcastToConversation(id, { type: "new_message", message: msg });
  return res.json(msg);
});

app.post("/api/conversations/:id/upload", authMiddleware, upload.single("file"), (req, res) => {
  const { id } = req.params;
  if (!stmts.isMember.get(id, req.user.id)) {
    return res.status(403).json({ error: "Нет доступа к этому чату" });
  }
  if (!req.file) return res.status(400).json({ error: "Файл не загружен" });

  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const fileUrl = `${proto}://${host}/uploads/${req.file.filename}`;
  const msgId = uuidv4();
  const msgType = req.file.mimetype.startsWith("video/") ? "video" : "image";

  stmts.insertMessage.run(msgId, id, req.user.id, null, msgType,
    fileUrl, req.file.originalname, req.file.size, req.file.mimetype, null);

  const msg = {
    id: msgId,
    conversationId: id,
    senderId: req.user.id,
    content: null,
    deletedForAll: false,
    type: msgType,
    fileUrl,
    fileName: req.file.originalname,
    fileSize: req.file.size,
    mimeType: req.file.mimetype,
    replyTo: null, replyContent: null, replyType: null, replyDisplayName: null, replyUsername: null,
    editedAt: null,
    reactions: {},
    createdAt: new Date().toISOString(),
    sender: {
      id: req.user.id,
      username: req.user.username,
      displayName: req.user.display_name,
      avatar: req.user.avatar ?? null,
    },
  };

  broadcastToConversation(id, { type: "new_message", message: msg });
  return res.json(msg);
});

// ─── Редактирование сообщения ─────────────────────────────────────────────────
app.patch("/api/conversations/:id/messages/:msgId", authMiddleware, (req, res) => {
  const { id, msgId } = req.params;
  if (!stmts.isMember.get(id, req.user.id)) return res.status(403).json({ error: "Нет доступа" });
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: "Текст обязателен" });

  const msg = db.prepare("SELECT * FROM messages WHERE id = ? AND conversation_id = ?").get(msgId, id);
  if (!msg) return res.status(404).json({ error: "Сообщение не найдено" });
  if (msg.sender_id !== req.user.id) return res.status(403).json({ error: "Нельзя редактировать чужие сообщения" });

  stmts.editMessage.run(content.trim(), msgId, req.user.id);
  const editedAt = new Date().toISOString();

  broadcastToConversation(id, {
    type: "message_edited",
    messageId: msgId,
    conversationId: id,
    content: content.trim(),
    editedAt,
  });

  return res.json({ success: true, content: content.trim(), editedAt });
});

// ─── Удаление сообщения ───────────────────────────────────────────────────────
app.delete("/api/conversations/:id/messages/:msgId", authMiddleware, (req, res) => {
  const { id, msgId } = req.params;
  const forAll = req.query.forAll === "true" || req.body?.forAll === true;
  if (!stmts.isMember.get(id, req.user.id)) return res.status(403).json({ error: "Нет доступа" });

  const msg = db.prepare("SELECT * FROM messages WHERE id = ? AND conversation_id = ?").get(msgId, id);
  if (!msg) return res.status(404).json({ error: "Сообщение не найдено" });

  if (forAll) {
    if (msg.sender_id !== req.user.id) return res.status(403).json({ error: "Только автор может удалить для всех" });
    stmts.deleteMessageForAll.run(msgId);
    broadcastToConversation(id, { type: "message_deleted", messageId: msgId, conversationId: id, forAll: true });
  } else {
    if (msg.sender_id !== req.user.id) return res.status(403).json({ error: "Нельзя удалить чужое сообщение" });
    db.prepare("DELETE FROM messages WHERE id = ?").run(msgId);
    broadcastToConversation(id, { type: "message_deleted", messageId: msgId, conversationId: id, forAll: false });
  }

  return res.json({ success: true });
});

// ─── Реакции на сообщения ─────────────────────────────────────────────────────
app.post("/api/conversations/:id/messages/:msgId/react", authMiddleware, (req, res) => {
  const { id, msgId } = req.params;
  const { emoji } = req.body;
  if (!stmts.isMember.get(id, req.user.id)) return res.status(403).json({ error: "Нет доступа" });
  if (!emoji) return res.status(400).json({ error: "Emoji обязателен" });

  const msg = db.prepare("SELECT id FROM messages WHERE id = ? AND conversation_id = ?").get(msgId, id);
  if (!msg) return res.status(404).json({ error: "Сообщение не найдено" });

  const existing = db.prepare("SELECT 1 FROM dm_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?").get(msgId, req.user.id, emoji);
  if (existing) {
    stmts.removeDmReaction.run(msgId, req.user.id, emoji);
  } else {
    stmts.addDmReaction.run(msgId, req.user.id, emoji);
  }

  const reactions = stmts.getDmReactions.all(msgId);
  const grouped = {};
  for (const r of reactions) {
    if (!grouped[r.emoji]) grouped[r.emoji] = [];
    grouped[r.emoji].push({ userId: r.user_id, username: r.username });
  }

  broadcastToConversation(id, { type: "message_reaction", messageId: msgId, conversationId: id, reactions: grouped });
  return res.json({ reactions: grouped });
});

// ─── Закреплённые сообщения ───────────────────────────────────────────────────
app.get("/api/conversations/:id/pinned", authMiddleware, (req, res) => {
  const { id } = req.params;
  if (!stmts.isMember.get(id, req.user.id)) return res.status(403).json({ error: "Нет доступа" });
  const pinned = stmts.getPinnedMessages.all(id);
  return res.json(pinned.map(p => ({
    messageId: p.message_id,
    content: p.content,
    type: p.type,
    senderName: p.sender_name,
    senderUsername: p.sender_username,
    pinnedAt: p.pinned_at + "Z",
  })));
});

app.post("/api/conversations/:id/pin/:msgId", authMiddleware, (req, res) => {
  const { id, msgId } = req.params;
  if (!stmts.isMember.get(id, req.user.id)) return res.status(403).json({ error: "Нет доступа" });

  const msg = db.prepare("SELECT * FROM messages WHERE id = ? AND conversation_id = ?").get(msgId, id);
  if (!msg) return res.status(404).json({ error: "Сообщение не найдено" });

  const isPinned = stmts.isPinned.get(id, msgId);
  if (isPinned) {
    stmts.unpinMessage.run(id, msgId);
    broadcastToConversation(id, { type: "message_unpinned", messageId: msgId, conversationId: id });
    return res.json({ pinned: false });
  } else {
    stmts.pinMessage.run(id, msgId, req.user.id);
    broadcastToConversation(id, {
      type: "message_pinned",
      messageId: msgId,
      conversationId: id,
      content: msg.content,
      senderName: req.user.display_name,
    });
    return res.json({ pinned: true });
  }
});

// ─── Статус прочтения ─────────────────────────────────────────────────────────
app.post("/api/conversations/:id/read", authMiddleware, (req, res) => {
  const { id } = req.params;
  if (!stmts.isMember.get(id, req.user.id)) return res.status(403).json({ error: "Нет доступа" });
  stmts.upsertMessageRead.run(id, req.user.id);
  broadcastToConversation(id, {
    type: "conversation_read",
    conversationId: id,
    userId: req.user.id,
    readAt: new Date().toISOString(),
  });
  return res.json({ success: true });
});

app.get("/api/conversations/:id/read", authMiddleware, (req, res) => {
  const { id } = req.params;
  if (!stmts.isMember.get(id, req.user.id)) return res.status(403).json({ error: "Нет доступа" });
  const reads = stmts.getMessageReads.all(id);
  return res.json(reads.map(r => ({ userId: r.user_id, readAt: r.last_read_at + "Z" })));
});

// ─── Премиум ────────────────────────────────────────────────────────────────

app.get("/api/premium/status", authMiddleware, (req, res) => {
  const premium = stmts.getPremium.get(req.user.id);
  if (!premium || new Date(premium.expires_at) <= new Date()) {
    return res.json({ isPremium: false, premium: null });
  }
  return res.json({
    isPremium: true,
    premium: {
      expiresAt: premium.expires_at + "Z",
      badgeImage: premium.badge_image ?? null,
      activatedAt: premium.activated_at + "Z",
    },
  });
});

app.post("/api/premium/activate-promo", authMiddleware, (req, res) => {
  const { code } = req.body;
  if (!code?.trim()) return res.status(400).json({ error: "Укажите промокод" });
  const upperCode = code.trim().toUpperCase();

  // Check built-in promo codes
  const builtIn = BUILT_IN_PROMO_CODES[upperCode];
  if (builtIn) {
    const alreadyUsed = stmts.isPromoUsed.get(upperCode, req.user.id);
    if (alreadyUsed) return res.status(409).json({ error: "Вы уже использовали этот промокод" });

    // Sneak Peek promo code
    if (builtIn.type === "sneak_peek") {
      db.prepare("INSERT OR IGNORE INTO sneak_peek_access (user_id) VALUES (?)").run(req.user.id);
      stmts.insertPromoUse.run(upperCode, req.user.id);
      console.log(`[sneak_peek] Доступ открыт для @${req.user.username}`);
      return res.json({
        success: true,
        type: "sneak_peek",
        message: "Sneak Peek разблокирован!",
      });
    }

    const days = builtIn.days;
    const existing = stmts.getPremium.get(req.user.id);
    let expiresAt;
    if (existing && new Date(existing.expires_at) > new Date()) {
      const d = new Date(existing.expires_at);
      d.setDate(d.getDate() + days);
      expiresAt = d.toISOString().slice(0, 19);
    } else {
      const d = new Date();
      d.setDate(d.getDate() + days);
      expiresAt = d.toISOString().slice(0, 19);
    }

    stmts.upsertPremium.run(req.user.id, expiresAt, null);
    stmts.insertPromoUse.run(upperCode, req.user.id);

    console.log(`[premium] Промокод ${upperCode} активирован для @${req.user.username}, до ${expiresAt}`);
    return res.json({
      success: true,
      message: `🎉 Промокод активирован! Premium на ${days} дней.`,
      expiresAt: expiresAt + "Z",
    });
  }

  // Check DB promo codes
  const dbCode = stmts.getPromoCode.get(upperCode);
  if (!dbCode) return res.status(404).json({ error: "Промокод не найден или уже недействителен" });
  if (dbCode.expires_at && new Date(dbCode.expires_at) < new Date()) {
    return res.status(410).json({ error: "Срок действия промокода истёк" });
  }
  if (dbCode.uses >= dbCode.max_uses) {
    return res.status(410).json({ error: "Промокод уже исчерпан" });
  }
  const alreadyUsed = stmts.isPromoUsed.get(upperCode, req.user.id);
  if (alreadyUsed) return res.status(409).json({ error: "Вы уже использовали этот промокод" });

  const days = dbCode.days;
  const existing = stmts.getPremium.get(req.user.id);
  let expiresAt;
  if (existing && new Date(existing.expires_at) > new Date()) {
    const d = new Date(existing.expires_at);
    d.setDate(d.getDate() + days);
    expiresAt = d.toISOString().slice(0, 19);
  } else {
    const d = new Date();
    d.setDate(d.getDate() + days);
    expiresAt = d.toISOString().slice(0, 19);
  }

  stmts.upsertPremium.run(req.user.id, expiresAt, null);
  stmts.insertPromoUse.run(upperCode, req.user.id);
  db.prepare("UPDATE promo_codes SET uses = uses + 1 WHERE code = ?").run(upperCode);

  return res.json({
    success: true,
    message: `🎉 Промокод активирован! Premium на ${days} дней.`,
    expiresAt: expiresAt + "Z",
  });
});

// ─── Алиас: /api/promo/activate → /api/premium/activate-promo ────────────────
app.post("/api/promo/activate", authMiddleware, (req, res) => {
  const { code } = req.body;
  if (!code?.trim()) return res.status(400).json({ error: "Укажите промокод" });
  const upperCode = code.trim().toUpperCase();

  const builtIn = BUILT_IN_PROMO_CODES[upperCode];
  if (builtIn) {
    const alreadyUsed = stmts.isPromoUsed.get(upperCode, req.user.id);
    if (alreadyUsed) return res.status(409).json({ error: "Вы уже использовали этот промокод" });
    if (builtIn.type === "sneak_peek") {
      db.prepare("INSERT OR IGNORE INTO sneak_peek_access (user_id) VALUES (?)").run(req.user.id);
      stmts.insertPromoUse.run(upperCode, req.user.id);
      return res.json({ success: true, type: "sneak_peek", message: "Sneak Peek разблокирован!", isPremium: false });
    }
    const days = builtIn.days;
    const existing = stmts.getPremium.get(req.user.id);
    let expiresAt;
    if (existing && new Date(existing.expires_at) > new Date()) {
      const d = new Date(existing.expires_at); d.setDate(d.getDate() + days); expiresAt = d.toISOString().slice(0, 19);
    } else {
      const d = new Date(); d.setDate(d.getDate() + days); expiresAt = d.toISOString().slice(0, 19);
    }
    stmts.upsertPremium.run(req.user.id, expiresAt, null);
    stmts.insertPromoUse.run(upperCode, req.user.id);
    return res.json({ success: true, message: `🎉 Промокод активирован! Premium на ${days} дней.`, isPremium: true, premiumUntil: expiresAt + "Z" });
  }

  const dbCode = stmts.getPromoCode.get(upperCode);
  if (!dbCode) return res.status(404).json({ error: "Промокод не найден или уже недействителен" });
  if (dbCode.expires_at && new Date(dbCode.expires_at) < new Date()) return res.status(410).json({ error: "Срок действия промокода истёк" });
  if (dbCode.uses >= dbCode.max_uses) return res.status(410).json({ error: "Промокод уже исчерпан" });
  const alreadyUsed = stmts.isPromoUsed.get(upperCode, req.user.id);
  if (alreadyUsed) return res.status(409).json({ error: "Вы уже использовали этот промокод" });

  const days = dbCode.days;
  const existing = stmts.getPremium.get(req.user.id);
  let expiresAt;
  if (existing && new Date(existing.expires_at) > new Date()) {
    const d = new Date(existing.expires_at); d.setDate(d.getDate() + days); expiresAt = d.toISOString().slice(0, 19);
  } else {
    const d = new Date(); d.setDate(d.getDate() + days); expiresAt = d.toISOString().slice(0, 19);
  }
  stmts.upsertPremium.run(req.user.id, expiresAt, null);
  stmts.insertPromoUse.run(upperCode, req.user.id);
  db.prepare("UPDATE promo_codes SET uses = uses + 1 WHERE code = ?").run(upperCode);
  return res.json({ success: true, message: `🎉 Промокод активирован! Premium на ${days} дней.`, isPremium: true, premiumUntil: expiresAt + "Z" });
});

app.patch("/api/premium/badge", authMiddleware, upload.single("badge"), (req, res) => {
  const premium = stmts.getPremium.get(req.user.id);
  if (!premium || new Date(premium.expires_at) <= new Date()) {
    return res.status(403).json({ error: "Требуется Premium" });
  }
  if (!req.file) return res.status(400).json({ error: "Файл не загружен" });

  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const url = `${proto}://${host}/uploads/${req.file.filename}`;

  stmts.updatePremiumBadge.run(url, req.user.id);
  return res.json({ badgeImage: url });
});

// ─── Стрики (серии) — server-side ────────────────────────────────────────────

function getWeekId(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${week}`;
}

app.get("/api/conversations/:id/streak", authMiddleware, (req, res) => {
  const { id } = req.params;
  if (!stmts.isMember.get(id, req.user.id)) {
    return res.status(403).json({ error: "Нет доступа" });
  }
  const row = stmts.getStreak.get(id);
  if (!row || !row.active) {
    return res.json({ active: false, startedAt: null, restoreWeek: null });
  }
  return res.json({ active: true, startedAt: row.started_at + "Z", restoreWeek: row.restore_week ?? null });
});

app.post("/api/conversations/:id/streak/start", authMiddleware, (req, res) => {
  const { id } = req.params;
  if (!stmts.isMember.get(id, req.user.id)) {
    return res.status(403).json({ error: "Нет доступа" });
  }
  const now = new Date().toISOString().slice(0, 19);
  stmts.upsertStreakStart.run(id, now);
  return res.json({ active: true, startedAt: now + "Z", restoreWeek: null });
});

app.post("/api/conversations/:id/streak/stop", authMiddleware, (req, res) => {
  const { id } = req.params;
  if (!stmts.isMember.get(id, req.user.id)) {
    return res.status(403).json({ error: "Нет доступа" });
  }
  stmts.upsertStreakStop.run(id);
  return res.json({ active: false, startedAt: null, restoreWeek: null });
});

app.post("/api/conversations/:id/streak/restore", authMiddleware, (req, res) => {
  const { id } = req.params;
  if (!stmts.isMember.get(id, req.user.id)) {
    return res.status(403).json({ error: "Нет доступа" });
  }
  const row = stmts.getStreak.get(id);
  if (!row || !row.active) {
    return res.status(400).json({ error: "Серия не активна" });
  }
  const weekId = getWeekId(new Date());
  stmts.upsertStreakRestore.run(id, row.started_at, weekId);
  return res.json({ active: true, startedAt: row.started_at + "Z", restoreWeek: weekId });
});

// ─── Оплата ЮMoney ───────────────────────────────────────────────────────────

// Страница оплаты (HTML)
app.get("/payment", (req, res) => {
  const username = req.query.username || "";
  const token = req.query.token || "";
  const success = req.query.success === "1";
  const cancel = req.query.cancel === "1";

  const paymentUrl = `https://yoomoney.ru/quickpay/confirm.xml?` +
    `receiver=${YOOMONEY_WALLET}` +
    `&quickpay-form=shop` +
    `&targets=${encodeURIComponent("Omni Premium 30 дней")}` +
    `&paymentType=AC` +
    `&sum=${PREMIUM_PRICE_RUB}` +
    `&label=${encodeURIComponent(username)}` +
    `&successURL=${encodeURIComponent(`https://${DOMAIN}:${PORT}/payment?success=1&username=${username}&token=${token}`)}`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Omni Premium</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0A0A14;
      color: #F0F0FF;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 20px 16px 40px;
    }
    .container { max-width: 460px; width: 100%; }
    .logo-bar {
      text-align: center;
      padding: 28px 0 20px;
    }
    .logo-bar .logo-icon {
      width: 52px; height: 52px;
      background: linear-gradient(135deg, #6D28D9, #A78BFA);
      border-radius: 16px;
      display: inline-flex; align-items: center; justify-content: center;
      margin-bottom: 12px;
    }
    .logo-bar .logo-icon svg { width: 28px; height: 28px; }
    .logo-bar h1 { font-size: 22px; font-weight: 800; color: #A78BFA; letter-spacing: -0.5px; }
    .logo-bar p { color: #6060A0; font-size: 13px; margin-top: 2px; }
    .card {
      background: #10101E;
      border: 1px solid #1E1E38;
      border-radius: 20px;
      padding: 24px;
      margin-bottom: 14px;
    }
    .premium-header {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 22px;
      padding-bottom: 20px;
      border-bottom: 1px solid #1A1A30;
    }
    .ph-icon {
      width: 56px; height: 56px;
      background: linear-gradient(135deg, #7C3AED, #C4B5FD);
      border-radius: 18px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .ph-icon svg { width: 30px; height: 30px; }
    .ph-info h2 { font-size: 20px; font-weight: 700; color: #F0F0FF; line-height: 1.2; }
    .ph-info p { color: #7070A8; font-size: 13px; margin-top: 3px; }
    .features { list-style: none; }
    .features li {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 0; border-bottom: 1px solid #14142A;
      font-size: 14px; color: #D8D8F0; line-height: 1.4;
    }
    .features li:last-child { border-bottom: none; }
    .fi {
      width: 32px; height: 32px;
      border-radius: 10px;
      background: rgba(139,92,246,0.15);
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .fi svg { width: 16px; height: 16px; color: #A78BFA; }
    .price-block {
      background: linear-gradient(135deg, rgba(109,40,217,0.25), rgba(167,139,250,0.08));
      border: 1px solid rgba(139,92,246,0.35);
      border-radius: 16px;
      padding: 20px;
      text-align: center;
      margin-bottom: 18px;
    }
    .price-amount {
      font-size: 52px; font-weight: 800; color: #A78BFA;
      line-height: 1; letter-spacing: -2px;
    }
    .price-amount .cur { font-size: 26px; letter-spacing: 0; }
    .price-sub { color: #6060A0; font-size: 13px; margin-top: 6px; }
    .user-label {
      background: #0E0E20;
      border: 1px solid #1E1E38;
      border-radius: 12px;
      padding: 11px 15px;
      margin-bottom: 16px;
      font-size: 13px;
      color: #7070A8;
      display: flex; align-items: center; gap: 8px;
    }
    .user-label svg { width: 15px; height: 15px; flex-shrink: 0; }
    .user-label b { color: #C4B5FD; font-weight: 600; }
    .btn-pay {
      display: flex; width: 100%;
      background: linear-gradient(135deg, #6D28D9, #A78BFA);
      color: white; border: none; border-radius: 14px;
      padding: 15px 20px; font-size: 16px; font-weight: 700;
      text-align: center; text-decoration: none; cursor: pointer;
      transition: opacity 0.2s; align-items: center; justify-content: center; gap: 10px;
      box-shadow: 0 4px 24px rgba(109,40,217,0.4);
    }
    .btn-pay svg { width: 20px; height: 20px; }
    .btn-pay:hover { opacity: 0.88; }
    .promo-card {
      background: #10101E;
      border: 1px solid #1E1E38;
      border-radius: 20px;
      padding: 20px 24px;
    }
    .promo-header {
      display: flex; align-items: center; gap: 10px;
      margin-bottom: 16px;
    }
    .promo-header svg { width: 18px; height: 18px; color: #A78BFA; }
    .promo-card h3 { font-size: 15px; font-weight: 600; color: #E8E8FF; }
    .promo-hint { font-size: 13px; color: #6060A0; margin-bottom: 14px; }
    .promo-form { display: flex; gap: 10px; }
    .promo-input {
      flex: 1;
      background: #0E0E20;
      border: 1px solid #1E1E38;
      border-radius: 10px;
      padding: 12px 14px;
      color: #F0F0FF;
      font-size: 15px;
      font-family: inherit;
      letter-spacing: 1px;
    }
    .promo-input:focus { outline: none; border-color: #7C3AED; }
    .promo-input::placeholder { color: #40407A; letter-spacing: 0; }
    .btn-promo {
      background: rgba(139,92,246,0.18);
      border: 1px solid rgba(139,92,246,0.35);
      border-radius: 10px;
      color: #A78BFA;
      padding: 12px 18px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      white-space: nowrap;
    }
    .btn-promo:hover { background: rgba(139,92,246,0.28); }
    .promo-result { margin-top: 12px; font-size: 13px; display: flex; align-items: center; gap: 7px; }
    .promo-result svg { width: 15px; height: 15px; flex-shrink: 0; }
    .promo-ok { color: #34D399; }
    .promo-err { color: #F87171; }
    .result-block {
      text-align: center;
      padding: 32px 20px;
    }
    .result-icon-wrap {
      width: 72px; height: 72px;
      border-radius: 24px;
      display: inline-flex; align-items: center; justify-content: center;
      margin-bottom: 20px;
    }
    .result-icon-wrap svg { width: 36px; height: 36px; }
    .result-icon-success { background: rgba(52,211,153,0.15); border: 1px solid rgba(52,211,153,0.3); }
    .result-icon-cancel { background: rgba(248,113,113,0.15); border: 1px solid rgba(248,113,113,0.3); }
    .result-block h2 { font-size: 22px; font-weight: 700; margin-bottom: 10px; }
    .result-block p { color: #7070A8; font-size: 14px; line-height: 1.6; }
    .success-title { color: #34D399; }
    .cancel-title { color: #F87171; }
    .divider { height: 1px; background: #1A1A30; margin: 18px 0; }
    .note { font-size: 12px; color: #404070; text-align: center; margin-top: 12px; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo-bar">
      <div class="logo-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
      <h1>Omni</h1>
      <p>Мессенджер нового поколения</p>
    </div>

    ${success ? `
    <div class="card">
      <div class="result-block">
        <div class="result-icon-wrap result-icon-success">
          <svg viewBox="0 0 24 24" fill="none" stroke="#34D399" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <h2 class="success-title">Оплата прошла!</h2>
        <p>Ваш Premium будет активирован в течение нескольких минут.<br>Вернитесь в приложение и нажмите «Обновить статус».</p>
      </div>
    </div>
    ` : cancel ? `
    <div class="card">
      <div class="result-block">
        <div class="result-icon-wrap result-icon-cancel">
          <svg viewBox="0 0 24 24" fill="none" stroke="#F87171" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </div>
        <h2 class="cancel-title">Оплата отменена</h2>
        <p>Вы отменили платёж. Вернитесь назад и попробуйте снова — ничего не списалось.</p>
      </div>
    </div>
    ` : `
    <div class="card">
      <div class="premium-header">
        <div class="ph-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        </div>
        <div class="ph-info">
          <h2>Omni Premium</h2>
          <p>Подписка на 30 дней</p>
        </div>
      </div>

      <ul class="features">
        <li>
          <div class="fi"><svg viewBox="0 0 24 24" fill="none" stroke="#A78BFA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>
          Значок Premium рядом с ником во всех чатах
        </li>
        <li>
          <div class="fi"><svg viewBox="0 0 24 24" fill="none" stroke="#A78BFA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>
          Своя иконка/фото вместо звёздочки у ника
        </li>
        <li>
          <div class="fi"><svg viewBox="0 0 24 24" fill="none" stroke="#A78BFA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
          Увеличенный лимит файлов до 500 МБ
        </li>
        <li>
          <div class="fi"><svg viewBox="0 0 24 24" fill="none" stroke="#A78BFA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="10.5" r="2.5"/><circle cx="8.5" cy="7.5" r="2.5"/><circle cx="6.5" cy="12.5" r="2.5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg></div>
          Эксклюзивные темы оформления чатов
        </li>
        <li>
          <div class="fi"><svg viewBox="0 0 24 24" fill="none" stroke="#A78BFA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></div>
          Расширенная биография — до 500 символов
        </li>
        <li>
          <div class="fi"><svg viewBox="0 0 24 24" fill="none" stroke="#A78BFA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
          Метка поддержки — приоритетная помощь
        </li>
        <li>
          <div class="fi"><svg viewBox="0 0 24 24" fill="none" stroke="#A78BFA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></div>
          Цветной ник в серверах с поддержкой ролей
        </li>
      </ul>

      <div class="divider"></div>

      <div class="price-block">
        <div class="price-amount"><span class="cur">₽</span>${PREMIUM_PRICE_RUB}</div>
        <div class="price-sub">один раз · на 30 дней · автопродления нет</div>
      </div>

      ${username ? `
      <div class="user-label">
        <svg viewBox="0 0 24 24" fill="none" stroke="#7070A8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        Покупка для: <b>@${username}</b>
      </div>` : ""}

      <a href="${paymentUrl}" class="btn-pay">
        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
        Оплатить через ЮMoney
      </a>
      <p class="note">Нажимая кнопку, вы перейдёте на сайт ЮMoney для безопасной оплаты</p>
    </div>

    <div class="promo-card">
      <div class="promo-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="#A78BFA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
        <h3>Промокод</h3>
      </div>
      <p class="promo-hint">Введите промокод — получите Premium бесплатно</p>
      <div class="promo-form">
        <input class="promo-input" id="promoInput" placeholder="Введите промокод" autocapitalize="characters">
        <button class="btn-promo" onclick="activatePromo()">Применить</button>
      </div>
      <div class="promo-result" id="promoResult"></div>
    </div>
    `}
  </div>

  <script>
    const API_BASE = window.location.origin;
    const username = "${username}";

    async function activatePromo() {
      const code = document.getElementById('promoInput').value.trim();
      const result = document.getElementById('promoResult');
      if (!code) {
        result.innerHTML = '<span class="promo-err">Введите промокод</span>';
        return;
      }
      if (!username) {
        result.innerHTML = '<span class="promo-err">Сначала войдите в приложение и откройте эту страницу заново</span>';
        return;
      }

      result.innerHTML = 'Проверяем...';
      try {
        const token = new URLSearchParams(window.location.search).get('token');
        const res = await fetch('/api/premium/activate-promo', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + (token || ''),
            'X-Client-Version': '2.0.0'
          },
          body: JSON.stringify({ code })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          result.innerHTML = '<span class="promo-ok"><svg viewBox="0 0 24 24" fill="none" stroke="#34D399" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><polyline points="20 6 9 17 4 12"/></svg> ' + data.message + '</span>';
        } else {
          result.innerHTML = '<span class="promo-err"><svg viewBox="0 0 24 24" fill="none" stroke="#F87171" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> ' + (data.error || 'Ошибка') + '</span>';
        }
      } catch (e) {
        result.innerHTML = '<span class="promo-err"><svg viewBox="0 0 24 24" fill="none" stroke="#F87171" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Ошибка соединения</span>';
      }
    }
  </script>
</body>
</html>`);
});

// ЮMoney webhook (уведомление об оплате)
app.post("/api/payment/notify", express.urlencoded({ extended: false }), (req, res) => {
  const params = req.body;
  console.log("[payment] Уведомление ЮMoney:", params);

  // Верификация
  if (!verifyYuMoneyNotification(params)) {
    console.log("[payment] ❌ Неверная подпись уведомления!");
    return res.status(400).send("Invalid signature");
  }

  const amount = parseFloat(params.amount || "0");
  const username = params.label?.trim().toLowerCase();

  if (amount < PREMIUM_PRICE_RUB) {
    console.log(`[payment] ❌ Сумма недостаточна: ${amount} < ${PREMIUM_PRICE_RUB}`);
    return res.send("OK");
  }

  if (!username) {
    console.log("[payment] ❌ Нет имени пользователя в label");
    return res.send("OK");
  }

  const user = stmts.findUserByUsername.get(username);
  if (!user) {
    console.log(`[payment] ❌ Пользователь не найден: @${username}`);
    return res.send("OK");
  }

  const days = PREMIUM_DURATION_DAYS;
  const existing = stmts.getPremium.get(user.id);
  let expiresAt;
  if (existing && new Date(existing.expires_at) > new Date()) {
    const d = new Date(existing.expires_at);
    d.setDate(d.getDate() + days);
    expiresAt = d.toISOString().slice(0, 19);
  } else {
    const d = new Date();
    d.setDate(d.getDate() + days);
    expiresAt = d.toISOString().slice(0, 19);
  }

  stmts.upsertPremium.run(user.id, expiresAt, null);
  console.log(`[payment] ✅ Premium активирован для @${username} до ${expiresAt} (₽${amount})`);

  // Уведомить через WebSocket
  const clientWs = clients.get(user.id);
  if (clientWs && clientWs.readyState === WebSocket.OPEN) {
    clientWs.send(JSON.stringify({
      type: "premium_activated",
      expiresAt: expiresAt + "Z",
      message: "🎉 Premium активирован! Спасибо за поддержку!",
    }));
  }

  return res.send("OK");
});

// ─── Серверы ────────────────────────────────────────────────────────────────

app.get("/api/servers", authMiddleware, (req, res) => {
  const rows = stmts.getUserServers.all(req.user.id);
  return res.json(rows.map(formatServerBrief));
});

app.get("/api/servers/public", authMiddleware, (req, res) => {
  const rows = stmts.listPublicServers.all();
  return res.json(rows.map(formatServerBrief));
});

app.post("/api/servers", authMiddleware, (req, res) => {
  const { name, description, isPublic } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Название сервера обязательно" });
  if (name.trim().length > 100) return res.status(400).json({ error: "Название слишком длинное" });

  const serverId = uuidv4();
  const inviteCode = uuidv4().slice(0, 8).toUpperCase();

  stmts.insertServer.run(serverId, name.trim(), description?.trim() || null, null, req.user.id, inviteCode, isPublic ? 1 : 0);

  // Создаём роли по умолчанию
  const adminRoleId = uuidv4();
  const memberRoleId = uuidv4();
  stmts.insertRole.run(adminRoleId, serverId, "Администратор", "#E74C3C", PERMISSIONS.ADMINISTRATOR, 0, 1, 100);
  stmts.insertRole.run(memberRoleId, serverId, "Участник", "#99AAB5", DEFAULT_MEMBER_PERMS, 1, 0, 0);

  // Создаём каналы по умолчанию
  const generalId = uuidv4();
  const announcementsId = uuidv4();
  stmts.insertChannel.run(generalId, serverId, "general", "text", "Основной чат", 0);
  stmts.insertChannel.run(announcementsId, serverId, "announcements", "text", "Объявления", 1);

  // Добавляем владельца
  stmts.insertServerMember.run(serverId, req.user.id, adminRoleId, null);

  console.log(`[server] Создан сервер "${name}" (${serverId}) пользователем @${req.user.username}`);
  return res.json(formatServer(stmts.getServer.get(serverId)));
});

app.get("/api/servers/:id", authMiddleware, (req, res) => {
  const server = stmts.getServer.get(req.params.id);
  if (!server) return res.status(404).json({ error: "Сервер не найден" });

  const member = stmts.getServerMember.get(req.params.id, req.user.id);
  if (!member && !server.is_public) {
    return res.status(403).json({ error: "Нет доступа" });
  }

  return res.json(formatServer(server));
});

app.patch("/api/servers/:id", authMiddleware, (req, res) => {
  const server = stmts.getServer.get(req.params.id);
  if (!server) return res.status(404).json({ error: "Сервер не найден" });
  if (!canManageServer(server, req.user.id)) return res.status(403).json({ error: "Недостаточно прав" });

  const { name, description, isPublic } = req.body;
  stmts.updateServer.run(
    name?.trim() || server.name,
    description !== undefined ? description?.trim() || null : server.description,
    server.icon,
    isPublic !== undefined ? (isPublic ? 1 : 0) : server.is_public,
    server.id
  );
  return res.json(formatServer(stmts.getServer.get(server.id)));
});

app.delete("/api/servers/:id", authMiddleware, (req, res) => {
  const server = stmts.getServer.get(req.params.id);
  if (!server) return res.status(404).json({ error: "Сервер не найден" });
  if (server.owner_id !== req.user.id) return res.status(403).json({ error: "Только владелец может удалить сервер" });

  db.prepare("DELETE FROM servers WHERE id = ?").run(server.id);
  return res.json({ success: true });
});

// Присоединение по инвайт-коду
app.post("/api/servers/join/:code", authMiddleware, (req, res) => {
  const server = stmts.getServerByInvite.get(req.params.code);
  if (!server) return res.status(404).json({ error: "Неверный инвайт-код" });

  if (stmts.isBanned.get(server.id, req.user.id)) {
    return res.status(403).json({ error: "Вы заблокированы на этом сервере" });
  }

  const existing = stmts.getServerMember.get(server.id, req.user.id);
  if (existing) return res.json({ already: true, server: formatServerBrief(server) });

  const defaultRole = stmts.getDefaultRole.get(server.id);
  stmts.insertServerMember.run(server.id, req.user.id, defaultRole?.id || null, null);

  console.log(`[server] @${req.user.username} присоединился к "${server.name}"`);
  broadcastToServer(server.id, {
    type: "member_joined",
    serverId: server.id,
    userId: req.user.id,
    username: req.user.username,
    displayName: req.user.display_name,
  });

  return res.json(formatServer(server));
});

app.post("/api/servers/:id/join", authMiddleware, (req, res) => {
  const server = stmts.getServer.get(req.params.id);
  if (!server) return res.status(404).json({ error: "Сервер не найден" });
  if (!server.is_public) return res.status(403).json({ error: "Сервер приватный. Используйте код приглашения." });

  if (stmts.isBanned.get(server.id, req.user.id)) {
    return res.status(403).json({ error: "Вы заблокированы на этом сервере" });
  }

  const existing = stmts.getServerMember.get(server.id, req.user.id);
  if (existing) return res.json({ already: true, server: formatServerBrief(server) });

  const defaultRole = stmts.getDefaultRole.get(server.id);
  stmts.insertServerMember.run(server.id, req.user.id, defaultRole?.id || null, null);

  console.log(`[server] @${req.user.username} вступил в "${server.name}" (по ID)`);
  broadcastToServer(server.id, {
    type: "member_joined",
    serverId: server.id,
    userId: req.user.id,
    username: req.user.username,
    displayName: req.user.display_name,
  });

  return res.json(formatServer(server));
});

app.post("/api/servers/:id/leave", authMiddleware, (req, res) => {
  const server = stmts.getServer.get(req.params.id);
  if (!server) return res.status(404).json({ error: "Сервер не найден" });
  if (server.owner_id === req.user.id) {
    return res.status(400).json({ error: "Владелец не может покинуть сервер. Удалите его." });
  }

  stmts.removeServerMember.run(server.id, req.user.id);
  return res.json({ success: true });
});

// ─── Участники сервера ───────────────────────────────────────────────────────

app.get("/api/servers/:id/members", authMiddleware, (req, res) => {
  const server = stmts.getServer.get(req.params.id);
  if (!server) return res.status(404).json({ error: "Сервер не найден" });

  const member = stmts.getServerMember.get(req.params.id, req.user.id);
  if (!member) return res.status(403).json({ error: "Нет доступа" });

  const members = stmts.listServerMembers.all(req.params.id);
  return res.json(members.map(formatMember));
});

app.patch("/api/servers/:serverId/members/:userId", authMiddleware, (req, res) => {
  const server = stmts.getServer.get(req.params.serverId);
  if (!server) return res.status(404).json({ error: "Сервер не найден" });
  if (!canManageServer(server, req.user.id)) return res.status(403).json({ error: "Недостаточно прав" });

  const { roleId, nickname } = req.body;
  if (roleId !== undefined) {
    if (roleId) {
      const role = stmts.getRole.get(roleId);
      if (!role || role.server_id !== server.id) return res.status(400).json({ error: "Неверная роль" });
    }
    stmts.updateMemberRole.run(roleId || null, server.id, req.params.userId);
  }
  if (nickname !== undefined) {
    stmts.updateMemberNickname.run(nickname?.trim() || null, server.id, req.params.userId);
  }

  return res.json({ success: true });
});

app.delete("/api/servers/:serverId/members/:userId", authMiddleware, (req, res) => {
  const server = stmts.getServer.get(req.params.serverId);
  if (!server) return res.status(404).json({ error: "Сервер не найден" });

  const kickerMember = stmts.getServerMember.get(server.id, req.user.id);
  const kickerRole = kickerMember?.role_id ? stmts.getRole.get(kickerMember.role_id) : null;

  if (!hasPermission(kickerMember, kickerRole, PERMISSIONS.KICK_MEMBERS) && server.owner_id !== req.user.id) {
    return res.status(403).json({ error: "Нет прав кикать участников" });
  }

  stmts.removeServerMember.run(server.id, req.params.userId);
  broadcastToServer(server.id, {
    type: "member_kicked",
    serverId: server.id,
    userId: req.params.userId,
  });
  return res.json({ success: true });
});

// ─── Роли ────────────────────────────────────────────────────────────────────

app.get("/api/servers/:id/roles", authMiddleware, (req, res) => {
  const server = stmts.getServer.get(req.params.id);
  if (!server) return res.status(404).json({ error: "Сервер не найден" });

  const member = stmts.getServerMember.get(req.params.id, req.user.id);
  if (!member) return res.status(403).json({ error: "Нет доступа" });

  return res.json(stmts.listRoles.all(req.params.id).map(formatRole));
});

app.post("/api/servers/:id/roles", authMiddleware, (req, res) => {
  const server = stmts.getServer.get(req.params.id);
  if (!server) return res.status(404).json({ error: "Сервер не найден" });
  if (!canManageServer(server, req.user.id)) return res.status(403).json({ error: "Недостаточно прав" });

  const { name, color, permissions, isAdmin } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Название роли обязательно" });

  const roleId = uuidv4();
  const existingRoles = stmts.listRoles.all(server.id);
  stmts.insertRole.run(
    roleId, server.id, name.trim(),
    color || "#99AAB5",
    permissions || DEFAULT_MEMBER_PERMS,
    0, isAdmin ? 1 : 0,
    existingRoles.length
  );

  return res.json(formatRole(stmts.getRole.get(roleId)));
});

app.patch("/api/servers/:serverId/roles/:roleId", authMiddleware, (req, res) => {
  const server = stmts.getServer.get(req.params.serverId);
  if (!server) return res.status(404).json({ error: "Сервер не найден" });
  if (!canManageServer(server, req.user.id)) return res.status(403).json({ error: "Недостаточно прав" });

  const role = stmts.getRole.get(req.params.roleId);
  if (!role || role.server_id !== server.id) return res.status(404).json({ error: "Роль не найдена" });

  const { name, color, permissions, isAdmin } = req.body;
  stmts.updateRole.run(
    name?.trim() || role.name,
    color || role.color,
    permissions !== undefined ? permissions : role.permissions,
    isAdmin !== undefined ? (isAdmin ? 1 : 0) : role.is_admin,
    role.id
  );

  return res.json(formatRole(stmts.getRole.get(role.id)));
});

app.delete("/api/servers/:serverId/roles/:roleId", authMiddleware, (req, res) => {
  const server = stmts.getServer.get(req.params.serverId);
  if (!server) return res.status(404).json({ error: "Сервер не найден" });
  if (!canManageServer(server, req.user.id)) return res.status(403).json({ error: "Недостаточно прав" });

  const role = stmts.getRole.get(req.params.roleId);
  if (!role || role.server_id !== server.id) return res.status(404).json({ error: "Роль не найдена" });
  if (role.is_default) return res.status(400).json({ error: "Нельзя удалить роль по умолчанию" });

  stmts.deleteRole.run(role.id);
  return res.json({ success: true });
});

// ─── Каналы ──────────────────────────────────────────────────────────────────

app.get("/api/servers/:id/channels", authMiddleware, (req, res) => {
  const server = stmts.getServer.get(req.params.id);
  if (!server) return res.status(404).json({ error: "Сервер не найден" });

  const member = stmts.getServerMember.get(req.params.id, req.user.id);
  if (!member) return res.status(403).json({ error: "Нет доступа" });

  return res.json(stmts.listChannels.all(req.params.id).map(formatChannel));
});

app.post("/api/servers/:id/channels", authMiddleware, (req, res) => {
  const server = stmts.getServer.get(req.params.id);
  if (!server) return res.status(404).json({ error: "Сервер не найден" });
  if (!canManageServer(server, req.user.id)) return res.status(403).json({ error: "Недостаточно прав" });

  const { name, type, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Название канала обязательно" });

  const channelId = uuidv4();
  const channels = stmts.listChannels.all(server.id);
  stmts.insertChannel.run(channelId, server.id, name.trim().toLowerCase().replace(/\s+/g, "-"), type || "text", description?.trim() || null, channels.length);

  broadcastToServer(server.id, { type: "channel_created", channel: formatChannel(stmts.getChannel.get(channelId)) });
  return res.json(formatChannel(stmts.getChannel.get(channelId)));
});

app.patch("/api/channels/:id", authMiddleware, (req, res) => {
  const channel = stmts.getChannel.get(req.params.id);
  if (!channel) return res.status(404).json({ error: "Канал не найден" });

  const server = stmts.getServer.get(channel.server_id);
  if (!canManageServer(server, req.user.id)) return res.status(403).json({ error: "Недостаточно прав" });

  const { name, description, position, slowmodeSeconds } = req.body;
  stmts.updateChannel.run(
    name?.trim() || channel.name,
    description !== undefined ? description?.trim() || null : channel.description,
    position !== undefined ? position : channel.position,
    slowmodeSeconds !== undefined ? slowmodeSeconds : channel.slowmode_seconds,
    channel.id
  );

  return res.json(formatChannel(stmts.getChannel.get(channel.id)));
});

app.delete("/api/channels/:id", authMiddleware, (req, res) => {
  const channel = stmts.getChannel.get(req.params.id);
  if (!channel) return res.status(404).json({ error: "Канал не найден" });

  const server = stmts.getServer.get(channel.server_id);
  if (!canManageServer(server, req.user.id)) return res.status(403).json({ error: "Недостаточно прав" });

  const otherChannels = stmts.listChannels.all(channel.server_id).filter(c => c.id !== channel.id);
  if (otherChannels.length === 0) return res.status(400).json({ error: "Нельзя удалить последний канал" });

  stmts.deleteChannel.run(channel.id);
  broadcastToServer(channel.server_id, { type: "channel_deleted", channelId: channel.id });
  return res.json({ success: true });
});

// ─── Сообщения каналов ────────────────────────────────────────────────────────

app.get("/api/channels/:id/messages", authMiddleware, (req, res) => {
  const channel = stmts.getChannel.get(req.params.id);
  if (!channel) return res.status(404).json({ error: "Канал не найден" });

  const member = stmts.getServerMember.get(channel.server_id, req.user.id);
  if (!member) return res.status(403).json({ error: "Нет доступа" });

  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const rows = stmts.getChannelMessages.all(channel.id, limit);
  return res.json(rows.map(formatChannelMessage));
});

app.post("/api/channels/:id/messages", authMiddleware, (req, res) => {
  return res.status(403).json({ error: "Написание сообщений в серверах отключено" });

  const channel = stmts.getChannel.get(req.params.id);
  if (!channel) return res.status(404).json({ error: "Канал не найден" });

  const member = stmts.getServerMember.get(channel.server_id, req.user.id);
  if (!member) return res.status(403).json({ error: "Нет доступа" });

  const memberRole = member.role_id ? stmts.getRole.get(member.role_id) : null;
  const server = stmts.getServer.get(channel.server_id);
  if (server.owner_id !== req.user.id && !hasPermission({ ...member, owner_id: server.owner_id, user_id: req.user.id }, memberRole, PERMISSIONS.SEND_MESSAGES)) {
    return res.status(403).json({ error: "Нет прав отправлять сообщения" });
  }

  const { content, type = "text", replyTo } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: "Текст сообщения обязателен" });

  const msgId = uuidv4();
  stmts.insertChannelMessage.run(msgId, channel.id, req.user.id, content.trim(), type, null, null, null, null, replyTo || null);

  const msg = {
    id: msgId,
    channelId: channel.id,
    senderId: req.user.id,
    content: content.trim(),
    type,
    fileUrl: null, fileName: null, fileSize: null, mimeType: null,
    replyTo: replyTo || null,
    replyContent: null,
    replyDisplayName: null,
    editedAt: null,
    createdAt: new Date().toISOString(),
    sender: {
      id: req.user.id,
      username: req.user.username,
      displayName: req.user.display_name,
      avatar: req.user.avatar ?? null,
    },
  };

  broadcastToChannel(channel.id, channel.server_id, { type: "channel_message", message: msg });
  return res.json(msg);
});

app.post("/api/channels/:id/upload", authMiddleware, upload.single("file"), (req, res) => {
  return res.status(403).json({ error: "Написание сообщений в серверах отключено" });
  const channel = stmts.getChannel.get(req.params.id);
  if (!channel) return res.status(404).json({ error: "Канал не найден" });

  const member = stmts.getServerMember.get(channel.server_id, req.user.id);
  if (!member) return res.status(403).json({ error: "Нет доступа" });
  if (!req.file) return res.status(400).json({ error: "Файл не загружен" });

  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const fileUrl = `${proto}://${host}/uploads/${req.file.filename}`;
  const msgId = uuidv4();
  const msgType = req.file.mimetype.startsWith("video/") ? "video" : req.file.mimetype.startsWith("image/") ? "image" : "file";

  stmts.insertChannelMessage.run(msgId, channel.id, req.user.id, null, msgType,
    fileUrl, req.file.originalname, req.file.size, req.file.mimetype, null);

  const msg = {
    id: msgId,
    channelId: channel.id,
    senderId: req.user.id,
    content: null,
    type: msgType,
    fileUrl,
    fileName: req.file.originalname,
    fileSize: req.file.size,
    mimeType: req.file.mimetype,
    replyTo: null, replyContent: null, replyDisplayName: null,
    editedAt: null,
    createdAt: new Date().toISOString(),
    sender: {
      id: req.user.id,
      username: req.user.username,
      displayName: req.user.display_name,
      avatar: req.user.avatar ?? null,
    },
  };

  broadcastToChannel(channel.id, channel.server_id, { type: "channel_message", message: msg });
  return res.json(msg);
});

app.patch("/api/channels/:channelId/messages/:messageId", authMiddleware, (req, res) => {
  const channel = stmts.getChannel.get(req.params.channelId);
  if (!channel) return res.status(404).json({ error: "Канал не найден" });

  const member = stmts.getServerMember.get(channel.server_id, req.user.id);
  if (!member) return res.status(403).json({ error: "Нет доступа" });

  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: "Контент обязателен" });

  const result = stmts.editChannelMessage.run(content.trim(), req.params.messageId, req.user.id);
  if (result.changes === 0) return res.status(403).json({ error: "Нельзя редактировать чужое сообщение" });

  const editedAt = new Date().toISOString();
  broadcastToChannel(req.params.channelId, channel.server_id, {
    type: "channel_message_edited",
    channelId: req.params.channelId,
    messageId: req.params.messageId,
    content: content.trim(),
    editedAt,
  });

  return res.json({ success: true, editedAt });
});

app.delete("/api/channels/:channelId/messages/:messageId", authMiddleware, (req, res) => {
  const channel = stmts.getChannel.get(req.params.channelId);
  if (!channel) return res.status(404).json({ error: "Канал не найден" });

  const member = stmts.getServerMember.get(channel.server_id, req.user.id);
  if (!member) return res.status(403).json({ error: "Нет доступа" });

  const memberRole = member.role_id ? stmts.getRole.get(member.role_id) : null;
  const server = stmts.getServer.get(channel.server_id);
  const canManageMsg = hasPermission({ ...member, owner_id: server.owner_id, user_id: req.user.id }, memberRole, PERMISSIONS.MANAGE_MESSAGES) || server.owner_id === req.user.id;

  // Check if message belongs to user
  const msg = db.prepare("SELECT sender_id FROM channel_messages WHERE id = ?").get(req.params.messageId);
  if (!msg) return res.status(404).json({ error: "Сообщение не найдено" });
  if (msg.sender_id !== req.user.id && !canManageMsg) {
    return res.status(403).json({ error: "Нет прав удалять это сообщение" });
  }

  stmts.deleteChannelMessage.run(req.params.messageId);
  broadcastToChannel(channel.id, channel.server_id, {
    type: "channel_message_deleted",
    channelId: channel.id,
    messageId: req.params.messageId,
  });
  return res.json({ success: true });
});

// ─── Баны ────────────────────────────────────────────────────────────────────

app.post("/api/servers/:serverId/bans/:userId", authMiddleware, (req, res) => {
  const server = stmts.getServer.get(req.params.serverId);
  if (!server) return res.status(404).json({ error: "Сервер не найден" });

  const bannerMember = stmts.getServerMember.get(server.id, req.user.id);
  const bannerRole = bannerMember?.role_id ? stmts.getRole.get(bannerMember.role_id) : null;
  if (!hasPermission({ ...bannerMember, owner_id: server.owner_id, user_id: req.user.id }, bannerRole, PERMISSIONS.BAN_MEMBERS) && server.owner_id !== req.user.id) {
    return res.status(403).json({ error: "Нет прав банить" });
  }

  if (req.params.userId === server.owner_id) return res.status(400).json({ error: "Нельзя забанить владельца" });

  const { reason } = req.body;
  stmts.banMember.run(server.id, req.params.userId, reason?.trim() || null);
  stmts.removeServerMember.run(server.id, req.params.userId);

  broadcastToServer(server.id, {
    type: "member_banned",
    serverId: server.id,
    userId: req.params.userId,
  });

  return res.json({ success: true });
});

app.delete("/api/servers/:serverId/bans/:userId", authMiddleware, (req, res) => {
  const server = stmts.getServer.get(req.params.serverId);
  if (!server) return res.status(404).json({ error: "Сервер не найден" });
  if (!canManageServer(server, req.user.id)) return res.status(403).json({ error: "Недостаточно прав" });

  stmts.unbanMember.run(server.id, req.params.userId);
  return res.json({ success: true });
});

app.get("/api/servers/:id/bans", authMiddleware, (req, res) => {
  const server = stmts.getServer.get(req.params.id);
  if (!server) return res.status(404).json({ error: "Сервер не найден" });
  if (!canManageServer(server, req.user.id)) return res.status(403).json({ error: "Недостаточно прав" });

  return res.json(stmts.listBans.all(req.params.id));
});

// ─── Alias: POST /api/premium/badge (mobile app uses POST, server had PATCH) ──

app.post("/api/premium/badge", authMiddleware, upload.single("badge"), (req, res) => {
  const premium = stmts.getPremium.get(req.user.id);
  if (!premium || new Date(premium.expires_at) <= new Date()) {
    return res.status(403).json({ error: "Требуется Premium" });
  }
  if (!req.file) return res.status(400).json({ error: "Файл не загружен" });

  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const url = `${proto}://${host}/uploads/${req.file.filename}`;

  stmts.updatePremiumBadge.run(url, req.user.id);
  console.log(`[premium] Значок обновлён для @${req.user.username}`);
  return res.json({ badgeImage: url });
});

// ─── Server-side streak count ─────────────────────────────────────────────────

app.get("/api/conversations/:id/streak/count", authMiddleware, (req, res) => {
  const { id } = req.params;
  if (!stmts.isMember.get(id, req.user.id)) {
    return res.status(403).json({ error: "Нет доступа" });
  }

  const row = stmts.getStreak.get(id);
  if (!row || !row.active || !row.started_at) {
    return res.json({ active: false, count: 0, startedAt: null });
  }

  // Fetch all messages since the streak started (up to 500)
  const msgs = db.prepare(
    "SELECT sender_id, date(created_at) as day FROM messages WHERE conversation_id = ? AND created_at >= ? ORDER BY created_at ASC LIMIT 500"
  ).all(id, row.started_at);

  // Find the 2 members
  const memberRows = stmts.getConversationMembers.all(id);
  if (memberRows.length < 2) {
    return res.json({ active: true, count: 0, startedAt: row.started_at + "Z" });
  }

  const [memberA, memberB] = [memberRows[0].id, memberRows[1].id];

  // Build daily map
  const dayMap = {};
  for (const m of msgs) {
    if (!dayMap[m.day]) dayMap[m.day] = { a: false, b: false };
    if (m.sender_id === memberA) dayMap[m.day].a = true;
    if (m.sender_id === memberB) dayMap[m.day].b = true;
  }

  // Find mutual days (both sent)
  const mutualDays = Object.keys(dayMap)
    .filter((d) => dayMap[d].a && dayMap[d].b)
    .sort();

  if (mutualDays.length === 0) {
    return res.json({ active: true, count: 0, startedAt: row.started_at + "Z" });
  }

  // Count consecutive days ending today or yesterday
  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterdayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const lastMutual = mutualDays[mutualDays.length - 1];

  // Streak must end at today or yesterday to be "alive"
  if (lastMutual < yesterdayStr) {
    return res.json({ active: true, count: 0, startedAt: row.started_at + "Z" });
  }

  let count = 0;
  let cursor = lastMutual;
  for (let i = mutualDays.length - 1; i >= 0; i--) {
    if (mutualDays[i] === cursor) {
      count++;
      const d = new Date(cursor);
      d.setUTCDate(d.getUTCDate() - 1);
      cursor = d.toISOString().slice(0, 10);
    } else {
      break;
    }
  }

  // If last mutual was yesterday and today has mutual messages, add 1
  if (lastMutual === yesterdayStr && dayMap[todayStr]?.a && dayMap[todayStr]?.b) {
    count++;
  }

  return res.json({
    active: true,
    count,
    startedAt: row.started_at + "Z",
    lastMutualDay: lastMutual,
  });
});

// ─── Администрирование ────────────────────────────────────────────────────────

const ADMIN_SECRET = process.env.ADMIN_SECRET || "duo_admin_change_me";

function adminMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Требуется авторизация" });
  }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET);
    const user = stmts.findUserById.get(payload.userId);
    if (!user) return res.status(401).json({ error: "Пользователь не найден" });
    if (!payload.isAdmin && user.is_admin !== 1) {
      return res.status(403).json({ error: "Доступ запрещён: требуются права администратора" });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Неверный токен" });
  }
}

app.post("/api/admin/login", async (req, res) => {
  const { username, password, adminSecret } = req.body;
  if (!username?.trim() || !password?.trim() || !adminSecret?.trim()) {
    return res.status(400).json({ error: "Заполните все поля" });
  }
  if (adminSecret.trim() !== ADMIN_SECRET) {
    return res.status(403).json({ error: "Неверный секрет администратора" });
  }
  const user = stmts.findUserByUsername.get(username.trim().toLowerCase());
  if (!user) return res.status(401).json({ error: "Неверное имя пользователя или пароль" });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Неверное имя пользователя или пароль" });
  const token = jwt.sign({ userId: user.id, isAdmin: true }, JWT_SECRET, { expiresIn: "7d" });
  console.log(`[admin] Вход администратора: @${user.username}`);
  return res.json({ token, username: user.username, displayName: user.display_name });
});

// ─── Compatibility routes ─────────────────────────────────────────────────────

app.get("/api/admin/promos", adminMiddleware, (req, res) => {
  const rows = db.prepare("SELECT * FROM promo_codes ORDER BY created_at DESC").all();
  return res.json({ promos: rows.map(r => ({ id: r.code, code: r.code, durationDays: r.days, maxUses: r.max_uses, usedCount: r.uses, expiresAt: r.expires_at ? r.expires_at + "Z" : null, createdAt: r.created_at + "Z" })) });
});

app.post("/api/admin/promos", adminMiddleware, (req, res) => {
  const { code, durationDays, maxUses } = req.body;
  if (!code?.trim()) return res.status(400).json({ error: "Код обязателен" });
  const upperCode = code.trim().toUpperCase();
  const existing = db.prepare("SELECT code FROM promo_codes WHERE code = ?").get(upperCode);
  if (existing) return res.status(409).json({ error: "Промокод с таким кодом уже существует" });
  const d = parseInt(durationDays) || 30;
  const mu = parseInt(maxUses) || 100;
  db.prepare("INSERT INTO promo_codes (code, type, days, max_uses, uses, expires_at) VALUES (?, 'free_premium', ?, ?, 0, ?)").run(upperCode, d, mu, null);
  return res.json({ id: upperCode, code: upperCode, durationDays: d, maxUses: mu, usedCount: 0 });
});

app.delete("/api/admin/promos/:id", adminMiddleware, (req, res) => {
  const upperCode = req.params.id.toUpperCase();
  db.prepare("DELETE FROM promo_uses WHERE code = ?").run(upperCode);
  db.prepare("DELETE FROM promo_codes WHERE code = ?").run(upperCode);
  return res.json({ success: true });
});

app.post("/api/admin/coins", adminMiddleware, (req, res) => {
  const { username, amount } = req.body;
  if (!username || !amount) return res.status(400).json({ error: "username и amount обязательны" });
  const user = stmts.findUserByUsername.get(username.replace('@', '').toLowerCase());
  if (!user) return res.status(404).json({ error: "Пользователь не найден" });
  stmts.addCoins.run(Number(amount), user.id);
  stmts.insertCoinsTx.run(uuidv4(), user.id, Number(amount), "admin_gift", `Начислено администратором`);
  broadcastToUser(user.id, { type: "coins_added", coins: (stmts.getCoins.get(user.id)?.coins ?? 0), amount: Number(amount) });
  return res.json({ success: true });
});

app.patch("/api/admin/users/:id/role", adminMiddleware, (req, res) => {
  const { id } = req.params;
  const { globalRole, ownerColor } = req.body;
  const requester = req.user;
  if (requester.global_role !== 'creator') return res.status(403).json({ error: "Только Creator может менять роли" });
  const user = stmts.findUserById.get(id);
  if (!user) return res.status(404).json({ error: "Пользователь не найден" });
  const validRoles = ['user', 'owner', 'curator', 'creator'];
  if (!validRoles.includes(globalRole)) return res.status(400).json({ error: "Недопустимая роль" });
  db.prepare("UPDATE users SET global_role = ? WHERE id = ?").run(globalRole, id);
  if (ownerColor) db.prepare("UPDATE users SET nickname_color = ? WHERE id = ?").run(ownerColor, id);
  return res.json({ success: true });
});

app.get("/api/admin/stats", adminMiddleware, (req, res) => {
  const users = db.prepare("SELECT COUNT(*) as c FROM users").get().c;
  const servers = db.prepare("SELECT COUNT(*) as c FROM servers").get().c;
  const messages = db.prepare("SELECT COUNT(*) as c FROM messages").get().c;
  const channelMessages = db.prepare("SELECT COUNT(*) as c FROM channel_messages").get().c;
  const premiumUsers = db.prepare("SELECT COUNT(*) as c FROM premium WHERE expires_at > datetime('now')").get().c;
  const promoCodes = db.prepare("SELECT COUNT(*) as c FROM promo_codes").get().c;
  return res.json({ users, servers, messages, channelMessages, premiumUsers, promoCodes });
});

app.get("/api/admin/users", adminMiddleware, (req, res) => {
  const { search } = req.query;
  let rows;
  if (search && search.trim()) {
    const q = `%${search.trim()}%`;
    rows = db.prepare("SELECT * FROM users WHERE username LIKE ? OR display_name LIKE ? ORDER BY created_at DESC LIMIT 50").all(q, q);
  } else {
    rows = db.prepare("SELECT * FROM users ORDER BY created_at DESC LIMIT 200").all();
  }
  const result = rows.map((u) => {
    const premium = stmts.getPremium.get(u.id);
    const isPremium = premium && new Date(premium.expires_at) > new Date();
    const mod = db.prepare("SELECT * FROM user_moderation WHERE user_id = ?").get(u.id);
    return {
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      bio: u.bio ?? null,
      avatar: u.avatar ?? null,
      globalRole: u.global_role ?? "user",
      isAdmin: u.is_admin === 1,
      createdAt: u.created_at + "Z",
      isPremium: isPremium,
      premiumUntil: isPremium ? premium.expires_at + "Z" : null,
      isBanned: mod?.is_banned === 1,
      banReason: mod?.ban_reason ?? null,
      isFrozen: mod?.is_frozen === 1,
      isMuted: mod?.is_muted === 1,
      muteUntil: mod?.mute_until ? mod.mute_until + "Z" : null,
    };
  });
  return res.json({ users: result });
});

app.post("/api/admin/users/:id/premium", adminMiddleware, (req, res) => {
  const { id } = req.params;
  const user = stmts.findUserById.get(id);
  if (!user) return res.status(404).json({ error: "Пользователь не найден" });

  const days = parseInt(req.body.days) || 30;
  const existing = stmts.getPremium.get(id);
  let expiresAt;
  if (existing && new Date(existing.expires_at) > new Date()) {
    const d = new Date(existing.expires_at);
    d.setDate(d.getDate() + days);
    expiresAt = d.toISOString().slice(0, 19);
  } else {
    const d = new Date();
    d.setDate(d.getDate() + days);
    expiresAt = d.toISOString().slice(0, 19);
  }

  stmts.upsertPremium.run(id, expiresAt, null);
  console.log(`[admin] Premium выдан @${user.username} на ${days} дней (до ${expiresAt})`);
  return res.json({ success: true, expiresAt: expiresAt + "Z" });
});

app.delete("/api/admin/users/:id/premium", adminMiddleware, (req, res) => {
  const { id } = req.params;
  const user = stmts.findUserById.get(id);
  if (!user) return res.status(404).json({ error: "Пользователь не найден" });

  db.prepare("DELETE FROM premium WHERE user_id = ?").run(id);
  console.log(`[admin] Premium отозван у @${user.username}`);
  return res.json({ success: true });
});

app.delete("/api/admin/users/:id", adminMiddleware, (req, res) => {
  const { id } = req.params;
  const user = stmts.findUserById.get(id);
  if (!user) return res.status(404).json({ error: "Пользователь не найден" });

  // Remove from conversations
  db.prepare("DELETE FROM conversation_members WHERE user_id = ?").run(id);
  // Remove messages
  db.prepare("DELETE FROM messages WHERE sender_id = ?").run(id);
  // Remove premium
  db.prepare("DELETE FROM premium WHERE user_id = ?").run(id);
  // Remove from servers
  db.prepare("DELETE FROM server_members WHERE user_id = ?").run(id);
  // Remove channel messages
  db.prepare("DELETE FROM channel_messages WHERE sender_id = ?").run(id);
  // Remove user
  db.prepare("DELETE FROM users WHERE id = ?").run(id);

  console.log(`[admin] Пользователь @${user.username} удалён`);
  return res.json({ success: true });
});

// ─── Модерация пользователей ─────────────────────────────────────────────────

app.get("/api/admin/users/:id/moderation", adminMiddleware, (req, res) => {
  const { id } = req.params;
  const user = stmts.findUserById.get(id);
  if (!user) return res.status(404).json({ error: "Пользователь не найден" });
  const mod = db.prepare("SELECT * FROM user_moderation WHERE user_id = ?").get(id);
  return res.json({
    userId: id,
    isBanned: mod?.is_banned === 1,
    banReason: mod?.ban_reason ?? null,
    isFrozen: mod?.is_frozen === 1,
    isMuted: mod?.is_muted === 1,
    muteUntil: mod?.mute_until ? mod.mute_until + "Z" : null,
  });
});

function checkRoleHierarchy(req, targetUser) {
  const requester = req.user;
  const requesterRole = requester.global_role || "user";
  const targetRole = targetUser.global_role || "user";
  if (requesterRole === "creator") return null;
  if (targetRole === "creator") return "Нельзя применить действие к Creator";
  if (targetRole === "curator" && requesterRole !== "creator") return "Нельзя применить действие к Curator";
  return null;
}

app.post("/api/admin/users/:id/ban", adminMiddleware, (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const user = stmts.findUserById.get(id);
  if (!user) return res.status(404).json({ error: "Пользователь не найден" });
  const err = checkRoleHierarchy(req, user);
  if (err) return res.status(403).json({ error: err });
  db.prepare(`INSERT INTO user_moderation (user_id, is_banned, ban_reason, updated_at)
    VALUES (?, 1, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET is_banned = 1, ban_reason = ?, updated_at = datetime('now')`).run(id, reason || null, reason || null);
  broadcastToUser(id, { type: "force_logout", reason: "banned" });
  console.log(`[admin] @${user.username} заблокирован. Причина: ${reason || "не указана"}`);
  return res.json({ success: true });
});

app.post("/api/admin/users/:id/unban", adminMiddleware, (req, res) => {
  const { id } = req.params;
  const user = stmts.findUserById.get(id);
  if (!user) return res.status(404).json({ error: "Пользователь не найден" });
  db.prepare(`INSERT INTO user_moderation (user_id, is_banned, updated_at)
    VALUES (?, 0, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET is_banned = 0, ban_reason = NULL, updated_at = datetime('now')`).run(id);
  console.log(`[admin] @${user.username} разблокирован`);
  return res.json({ success: true });
});

app.post("/api/admin/users/:id/freeze", adminMiddleware, (req, res) => {
  const { id } = req.params;
  const user = stmts.findUserById.get(id);
  if (user) { const err = checkRoleHierarchy(req, user); if (err) return res.status(403).json({ error: err }); }
  if (!user) return res.status(404).json({ error: "Пользователь не найден" });
  db.prepare(`INSERT INTO user_moderation (user_id, is_frozen, updated_at)
    VALUES (?, 1, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET is_frozen = 1, updated_at = datetime('now')`).run(id);
  broadcastToUser(id, { type: "account_frozen" });
  console.log(`[admin] @${user.username} заморожен`);
  return res.json({ success: true });
});

app.post("/api/admin/users/:id/unfreeze", adminMiddleware, (req, res) => {
  const { id } = req.params;
  const user = stmts.findUserById.get(id);
  if (!user) return res.status(404).json({ error: "Пользователь не найден" });
  db.prepare(`INSERT INTO user_moderation (user_id, is_frozen, updated_at)
    VALUES (?, 0, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET is_frozen = 0, updated_at = datetime('now')`).run(id);
  console.log(`[admin] @${user.username} разморожен`);
  return res.json({ success: true });
});

app.post("/api/admin/users/:id/mute", adminMiddleware, (req, res) => {
  const { id } = req.params;
  const { minutes = 60 } = req.body;
  const user = stmts.findUserById.get(id);
  if (!user) return res.status(404).json({ error: "Пользователь не найден" });
  const roleErr = checkRoleHierarchy(req, user);
  if (roleErr) return res.status(403).json({ error: roleErr });
  const muteUntil = new Date(Date.now() + Number(minutes) * 60000).toISOString().replace("T", " ").slice(0, 19);
  db.prepare(`INSERT INTO user_moderation (user_id, is_muted, mute_until, updated_at)
    VALUES (?, 1, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET is_muted = 1, mute_until = ?, updated_at = datetime('now')`).run(id, muteUntil, muteUntil);
  broadcastToUser(id, { type: "account_muted", muteUntil });
  console.log(`[admin] @${user.username} замьючен на ${minutes} мин.`);
  return res.json({ success: true, muteUntil });
});

app.post("/api/admin/users/:id/unmute", adminMiddleware, (req, res) => {
  const { id } = req.params;
  const user = stmts.findUserById.get(id);
  if (!user) return res.status(404).json({ error: "Пользователь не найден" });
  db.prepare(`INSERT INTO user_moderation (user_id, is_muted, mute_until, updated_at)
    VALUES (?, 0, NULL, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET is_muted = 0, mute_until = NULL, updated_at = datetime('now')`).run(id);
  console.log(`[admin] @${user.username} размьючен`);
  return res.json({ success: true });
});

app.get("/api/admin/servers", adminMiddleware, (req, res) => {
  const rows = db.prepare("SELECT s.*, u.username as owner_username FROM servers s LEFT JOIN users u ON s.owner_id = u.id ORDER BY s.created_at DESC").all();
  const result = rows.map((s) => {
    const memberCount = stmts.memberCount.get(s.id)?.count ?? 0;
    const channelCount = db.prepare("SELECT COUNT(*) as c FROM channels WHERE server_id = ?").get(s.id)?.c ?? 0;
    return {
      id: s.id,
      name: s.name,
      description: s.description ?? null,
      icon: s.icon ?? null,
      ownerId: s.owner_id,
      ownerUsername: s.owner_username ?? null,
      inviteCode: s.invite_code,
      isPublic: s.is_public === 1,
      memberCount,
      channelCount,
      createdAt: s.created_at + "Z",
    };
  });
  return res.json(result);
});

app.delete("/api/admin/servers/:id", adminMiddleware, (req, res) => {
  const { id } = req.params;
  const server = stmts.getServer.get(id);
  if (!server) return res.status(404).json({ error: "Сервер не найден" });

  db.prepare("DELETE FROM servers WHERE id = ?").run(id);
  console.log(`[admin] Сервер "${server.name}" удалён`);
  return res.json({ success: true });
});

app.get("/api/admin/promo-codes", adminMiddleware, (req, res) => {
  const rows = db.prepare("SELECT * FROM promo_codes ORDER BY created_at DESC").all();
  return res.json(rows.map((r) => ({
    code: r.code,
    type: r.type,
    days: r.days,
    maxUses: r.max_uses,
    uses: r.uses,
    expiresAt: r.expires_at ? r.expires_at + "Z" : null,
    createdAt: r.created_at + "Z",
  })));
});

app.post("/api/admin/promo-codes", adminMiddleware, (req, res) => {
  const { code, days, maxUses, expiresAt } = req.body;
  if (!code?.trim()) return res.status(400).json({ error: "Код обязателен" });

  const upperCode = code.trim().toUpperCase();
  const existing = db.prepare("SELECT code FROM promo_codes WHERE code = ?").get(upperCode);
  if (existing) return res.status(409).json({ error: "Промокод с таким кодом уже существует" });

  const d = parseInt(days) || 30;
  const mu = parseInt(maxUses) || 1;
  const exp = expiresAt ? new Date(expiresAt).toISOString().slice(0, 19) : null;

  db.prepare(
    "INSERT INTO promo_codes (code, type, days, max_uses, uses, expires_at) VALUES (?, 'free_premium', ?, ?, 0, ?)"
  ).run(upperCode, d, mu, exp);

  console.log(`[admin] Промокод ${upperCode} создан (${d} дн., до ${exp ?? "∞"})`);
  return res.json({
    code: upperCode,
    type: "free_premium",
    days: d,
    maxUses: mu,
    uses: 0,
    expiresAt: exp ? exp + "Z" : null,
    createdAt: new Date().toISOString(),
  });
});

app.delete("/api/admin/promo-codes/:code", adminMiddleware, (req, res) => {
  const { code } = req.params;
  const upperCode = code.toUpperCase();
  const existing = db.prepare("SELECT code FROM promo_codes WHERE code = ?").get(upperCode);
  if (!existing) return res.status(404).json({ error: "Промокод не найден" });

  db.prepare("DELETE FROM promo_uses WHERE code = ?").run(upperCode);
  db.prepare("DELETE FROM promo_codes WHERE code = ?").run(upperCode);
  console.log(`[admin] Промокод ${upperCode} удалён`);
  return res.json({ success: true });
});

// ─── WebSocket ───────────────────────────────────────────────────────────────

const clients = new Map(); // userId -> ws
const serverSubscriptions = new Map(); // serverId -> Set<userId>

function broadcastToConversation(conversationId, payload) {
  const members = stmts.getConversationMembers.all(conversationId);
  const json = JSON.stringify(payload);
  for (const member of members) {
    const clientWs = clients.get(member.id);
    if (clientWs && clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(json);
    }
  }
}

function broadcastToServer(serverId, payload) {
  const subs = serverSubscriptions.get(serverId);
  if (!subs) return;
  const json = JSON.stringify(payload);
  for (const userId of subs) {
    const ws = clients.get(userId);
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(json);
  }
}

function broadcastToChannel(channelId, serverId, payload) {
  broadcastToServer(serverId, payload);
}

function broadcastToUser(userId, payload) {
  const ws = clients.get(userId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

let server;

const sslKeyPath = `/etc/letsencrypt/live/${DOMAIN}/privkey.pem`;
const sslCertPath = `/etc/letsencrypt/live/${DOMAIN}/fullchain.pem`;

if (fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath)) {
  const sslOptions = {
    key: fs.readFileSync(sslKeyPath),
    cert: fs.readFileSync(sslCertPath),
  };
  server = https.createServer(sslOptions, app);
  console.log("[ssl] HTTPS включён");
} else {
  server = http.createServer(app);
  console.log("[ssl] SSL сертификаты не найдены, запуск на HTTP");
}

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `https://${DOMAIN}`);
  const token = url.searchParams.get("token");
  const clientVersion = url.searchParams.get("version") || "2.0.0";
  const userAgent = req.headers["user-agent"] || "";

  if (!token) {
    ws.close(1008, "token обязателен");
    return;
  }

  let user;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    user = stmts.findUserById.get(payload.userId);
  } catch {
    ws.close(1008, "Неверный токен");
    return;
  }

  if (!user) {
    ws.close(1008, "Пользователь не найден");
    return;
  }

  clients.set(user.id, ws);

  // Subscribe to user's servers
  const userServers = stmts.getUserServers.all(user.id);
  for (const s of userServers) {
    if (!serverSubscriptions.has(s.id)) {
      serverSubscriptions.set(s.id, new Set());
    }
    serverSubscriptions.get(s.id).add(user.id);
  }

  console.log(`[ws] ✅ @${user.username} подключён (v${clientVersion})`);
  ws.send(JSON.stringify({
    type: "connected",
    userId: user.id,
    serverVersion: SERVER_VERSION,
  }));

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      // Subscribe to a server channel
      if (msg.type === "subscribe_server" && msg.serverId) {
        const member = stmts.getServerMember.get(msg.serverId, user.id);
        if (member) {
          if (!serverSubscriptions.has(msg.serverId)) {
            serverSubscriptions.set(msg.serverId, new Set());
          }
          serverSubscriptions.get(msg.serverId).add(user.id);
          ws.send(JSON.stringify({ type: "subscribed", serverId: msg.serverId }));
        }
      }
      // Unsubscribe from server
      if (msg.type === "unsubscribe_server" && msg.serverId) {
        serverSubscriptions.get(msg.serverId)?.delete(user.id);
      }
      // Typing indicator
      if (msg.type === "typing" && msg.conversationId) {
        if (stmts.isMember.get(msg.conversationId, user.id)) {
          broadcastToConversation(msg.conversationId, {
            type: "typing",
            conversationId: msg.conversationId,
            userId: user.id,
            username: user.username,
          });
        }
      }
      if (msg.type === "channel_typing" && msg.channelId && msg.serverId) {
        broadcastToChannel(msg.channelId, msg.serverId, {
          type: "channel_typing",
          channelId: msg.channelId,
          userId: user.id,
          username: user.username,
        });
      }
      // Ping/pong
      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", t: Date.now() }));
      }
      // ── Call signaling ──────────────────────────────────────────────────
      if (msg.type === "call_offer" && msg.targetUserId) {
        const targetWs = clients.get(msg.targetUserId);
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify({
            type: "incoming_call",
            callId: msg.callId,
            callType: msg.callType || "voice",
            conversationId: msg.conversationId,
            callerId: user.id,
            callerName: user.display_name || user.username,
            callerAvatar: user.avatar,
            offer: msg.offer,
          }));
        } else {
          ws.send(JSON.stringify({ type: "call_unavailable", callId: msg.callId }));
        }
      }
      if (msg.type === "call_answer" && msg.callerId) {
        const callerWs = clients.get(msg.callerId);
        if (callerWs && callerWs.readyState === WebSocket.OPEN) {
          callerWs.send(JSON.stringify({
            type: "call_accepted",
            callId: msg.callId,
            answer: msg.answer,
            responderId: user.id,
          }));
        }
      }
      if (msg.type === "call_reject" && msg.callerId) {
        const callerWs = clients.get(msg.callerId);
        if (callerWs && callerWs.readyState === WebSocket.OPEN) {
          callerWs.send(JSON.stringify({
            type: "call_rejected",
            callId: msg.callId,
            responderId: user.id,
          }));
        }
      }
      if (msg.type === "call_end" && msg.targetUserId) {
        const targetWs = clients.get(msg.targetUserId);
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify({
            type: "call_ended",
            callId: msg.callId,
            endedBy: user.id,
          }));
        }
      }
      if (msg.type === "call_ice" && msg.targetUserId) {
        const targetWs = clients.get(msg.targetUserId);
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify({
            type: "call_ice",
            callId: msg.callId,
            candidate: msg.candidate,
            senderId: user.id,
          }));
        }
      }
      // Relay raw audio for Python desktop clients
      if (msg.type === "call_audio" && msg.targetUserId) {
        const targetWs = clients.get(msg.targetUserId);
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify({
            type: "call_audio",
            callId: msg.callId,
            senderId: user.id,
            audio: msg.audio,
          }));
        }
      }
    } catch {}
  });

  ws.on("close", () => {
    if (clients.get(user.id) === ws) {
      clients.delete(user.id);
      // Remove from server subscriptions
      for (const [, subs] of serverSubscriptions) {
        subs.delete(user.id);
      }
    }
    console.log(`[ws] ❌ @${user.username} отключён`);
  });

  ws.on("error", (err) => {
    console.error(`[ws] Ошибка (@${user.username}):`, err.message);
  });
});

// Fix DB file permissions
setTimeout(() => {
  try {
    if (fs.existsSync(DB_PATH)) fs.chmodSync(DB_PATH, 0o666);
    if (fs.existsSync(DB_PATH + "-wal")) fs.chmodSync(DB_PATH + "-wal", 0o666);
    if (fs.existsSync(DB_PATH + "-shm")) fs.chmodSync(DB_PATH + "-shm", 0o666);
    console.log("[db] ✅ Права на файлы БД исправлены");
  } catch (err) {
    console.log("[db] Не удалось исправить права:", err.message);
  }
}, 1000);

// ─── Создание аккаунта администратора и OmniBot ───────────────────────────────
(async () => {
  // Admin
  const existing = stmts.findUserByUsername.get("admin");
  if (!existing) {
    const adminId = uuidv4();
    const fakeHash = await bcrypt.hash(uuidv4(), 10);
    stmts.insertUser.run(adminId, "admin", fakeHash, "admin");
    stmts.setAdmin.run();
    const farFuture = new Date("2099-12-31").toISOString().replace("T", " ").slice(0, 19);
    stmts.upsertPremium.run(adminId, farFuture, null);
    stmts.addCoins.run(99999, adminId);
    console.log("[admin] Аккаунт администратора создан: @admin");
  } else if (existing.is_admin !== 1) {
    stmts.setAdmin.run();
    console.log("[admin] Аккаунт @admin помечен как администратор");
  }

  // OmniBot
  const existingBot = stmts.findUserByUsername.get("OmniBot");
  if (!existingBot) {
    const botId = uuidv4();
    const botHash = await bcrypt.hash(uuidv4(), 6);
    stmts.insertUser.run(botId, "OmniBot", botHash, "OmniBot");
    stmts.addCoins.run(999999999, botId);
    console.log("[bot] Аккаунт OmniBot создан");
  }
})();

server.listen(PORT, "0.0.0.0", () => {
  const proto = server instanceof https.Server ? "https" : "http";
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log(`║       Omni Server v${SERVER_VERSION} — ЗАПУЩЕН                   ║`);
  console.log(`║  ${proto.toUpperCase()}: ${proto}://${DOMAIN}:${PORT}                   ║`);
  console.log(`║  🌐 Веб-мессенджер: ${proto}://${DOMAIN}:${PORT}/         ║`);
  console.log(`║  БД: ${DB_PATH}                 ║`);
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log("║  ✅ Все версии клиентов разрешены                    ║");
  console.log("║  🤖 OmniBot: подарки из магазина                     ║");
  console.log(`║  💳 ЮMoney: ${YOOMONEY_WALLET}                ║`);
  console.log(`║  💰 Цена Premium: ₽${PREMIUM_PRICE_RUB}/мес                      ║`);
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log("");
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║         🔐 КОД ДОСТУПА К ПРИВАТНЫМ ПАНЕЛЯМ          ║");
  console.log("║         (порты :1488 и :6767)                        ║");
  console.log("║                                                      ║");
  console.log(`║  ${MASTER_ACCESS_CODE.padEnd(52)}║`);
  console.log("║                                                      ║");
  console.log("║  ⚠️  Код меняется при каждом перезапуске сервера     ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log("");
});

// ─── Sneak Peek Admin Panel (Port 1488) ─────────────────────────────────────

const sneakApp = express();
sneakApp.use(cors());

const sneakUpload = multer({
  storage: multer.diskStorage({
    destination: SNEAK_PEEK_UPLOADS_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${uuidv4()}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
});

const sneakSessions = new Map();

function sneakAuthMiddleware(req, res, next) {
  const session = req.headers["x-sneak-session"] || req.query.session;
  if (!session || !sneakSessions.has(session)) {
    return res.status(401).json({ error: "Требуется авторизация" });
  }
  req.sneakSession = sneakSessions.get(session);
  next();
}

sneakApp.use("/uploads/sneakpeek", express.static(SNEAK_PEEK_UPLOADS_DIR));
sneakApp.use(express.json());

sneakApp.post("/api/login", (req, res) => {
  const { code } = req.body;
  if (!code || code.trim().toUpperCase() !== MASTER_ACCESS_CODE) {
    console.log(`[sneak_peek] ❌ Неверный код доступа с IP ${req.headers["x-forwarded-for"] || req.socket.remoteAddress}`);
    return res.status(403).json({ error: "Неверный код доступа" });
  }
  const sessionId = uuidv4();
  sneakSessions.set(sessionId, { createdAt: Date.now() });
  setTimeout(() => sneakSessions.delete(sessionId), 12 * 60 * 60 * 1000);
  console.log(`[sneak_peek] ✅ Успешный вход по коду доступа`);
  return res.json({ success: true, session: sessionId });
});

sneakApp.get("/api/list", sneakAuthMiddleware, (_req, res) => {
  const rows = db.prepare("SELECT * FROM sneak_peeks ORDER BY created_at DESC").all();
  return res.json(rows.map(r => ({
    id: r.id,
    title: r.title,
    description: r.description,
    videoUrl: `/uploads/sneakpeek/${path.basename(r.video_url)}`,
    thumbnailUrl: r.thumbnail_url ? `/uploads/sneakpeek/${path.basename(r.thumbnail_url)}` : null,
    createdAt: r.created_at,
  })));
});

sneakApp.post("/api/upload", sneakAuthMiddleware, sneakUpload.fields([
  { name: "video", maxCount: 1 },
  { name: "thumbnail", maxCount: 1 },
]), (req, res) => {
  const videoFile = req.files?.video?.[0];
  const thumbFile = req.files?.thumbnail?.[0];
  if (!videoFile) return res.status(400).json({ error: "Видео обязательно" });
  const { title, description } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: "Заголовок обязателен" });

  const videoPath = `/uploads/sneakpeek/${videoFile.filename}`;
  const thumbPath = thumbFile ? `/uploads/sneakpeek/${thumbFile.filename}` : null;
  const id = uuidv4();
  db.prepare("INSERT INTO sneak_peeks (id, title, description, video_url, thumbnail_url, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, title.trim(), description?.trim() || null, videoPath, thumbPath, req.sneakSession.username);
  return res.json({ success: true, id });
});

sneakApp.delete("/api/delete/:id", sneakAuthMiddleware, (req, res) => {
  const row = db.prepare("SELECT * FROM sneak_peeks WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Не найдено" });
  try {
    const vf = path.join(SNEAK_PEEK_UPLOADS_DIR, path.basename(row.video_url));
    if (fs.existsSync(vf)) fs.unlinkSync(vf);
    if (row.thumbnail_url) {
      const tf = path.join(SNEAK_PEEK_UPLOADS_DIR, path.basename(row.thumbnail_url));
      if (fs.existsSync(tf)) fs.unlinkSync(tf);
    }
  } catch {}
  db.prepare("DELETE FROM sneak_peeks WHERE id = ?").run(req.params.id);
  return res.json({ success: true });
});

sneakApp.use((req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sneak Peek Admin</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0d0d18; color: #e8e8ff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; min-height: 100vh; }
  .login-wrap { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
  .login-card { background: #1a1a2e; border: 1px solid #2a2a4a; border-radius: 20px; padding: 40px; width: 100%; max-width: 380px; }
  .login-title { font-size: 26px; font-weight: 700; text-align: center; margin-bottom: 8px; }
  .login-sub { color: #6060a0; text-align: center; font-size: 14px; margin-bottom: 28px; }
  .form-group { margin-bottom: 16px; }
  .form-group label { display: block; font-size: 13px; color: #9090c0; margin-bottom: 6px; }
  .form-group input, .form-group textarea { width: 100%; background: #0d0d18; border: 1px solid #2a2a4a; border-radius: 10px; padding: 12px 14px; color: #e8e8ff; font-size: 15px; outline: none; }
  .form-group input:focus, .form-group textarea:focus { border-color: #7c3aed; }
  .form-group textarea { min-height: 80px; resize: vertical; }
  .btn { width: 100%; padding: 14px; border-radius: 12px; border: none; cursor: pointer; font-size: 15px; font-weight: 600; }
  .btn-primary { background: #7c3aed; color: #fff; }
  .btn-primary:hover { background: #6d28d9; }
  .btn-danger { background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); width: auto; padding: 8px 16px; border-radius: 8px; font-size: 13px; }
  .btn-danger:hover { background: rgba(239,68,68,0.25); }
  .err { color: #ef4444; font-size: 13px; margin-top: 10px; text-align: center; }
  .main-wrap { max-width: 900px; margin: 0 auto; padding: 30px 20px; }
  .main-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 30px; }
  .main-header h1 { font-size: 24px; font-weight: 700; }
  .upload-card { background: #1a1a2e; border: 1px solid #2a2a4a; border-radius: 16px; padding: 24px; margin-bottom: 28px; }
  .upload-card h2 { font-size: 17px; font-weight: 600; margin-bottom: 18px; color: #c084fc; }
  .upload-row { display: flex; gap: 12px; }
  .upload-row .form-group { flex: 1; }
  .file-label { display: flex; align-items: center; gap: 8px; background: #0d0d18; border: 2px dashed #2a2a4a; border-radius: 10px; padding: 14px; cursor: pointer; color: #6060a0; font-size: 14px; transition: border-color 0.2s; }
  .file-label:hover { border-color: #7c3aed; color: #c084fc; }
  .file-label input { display: none; }
  .video-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
  .video-card { background: #1a1a2e; border: 1px solid #2a2a4a; border-radius: 14px; overflow: hidden; }
  .video-thumb { width: 100%; aspect-ratio: 16/9; object-fit: cover; background: #0d0d18; display: flex; align-items: center; justify-content: center; color: #3a3a6a; font-size: 36px; }
  .video-thumb video { width: 100%; height: 100%; object-fit: cover; }
  .video-info { padding: 14px; }
  .video-info h3 { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
  .video-info p { font-size: 13px; color: #6060a0; margin-bottom: 10px; line-height: 1.4; }
  .video-meta { font-size: 11px; color: #40407a; margin-bottom: 10px; }
  .loading { text-align: center; padding: 40px; color: #6060a0; }
  .progress { height: 4px; background: #0d0d18; border-radius: 2px; overflow: hidden; margin-top: 10px; display: none; }
  .progress-bar { height: 100%; background: #7c3aed; width: 0; transition: width 0.3s; }
</style>
</head>
<body>
<div id="app"></div>
<script>
let SESSION = localStorage.getItem('sneak_session') || '';
const BASE = '';

async function api(method, path, body, isForm = false) {
  const opts = { method, headers: { 'x-sneak-session': SESSION } };
  if (body) {
    if (isForm) opts.body = body;
    else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  }
  const r = await fetch(BASE + path, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Ошибка запроса');
  return d;
}

function render() {
  if (!SESSION) { renderLogin(); return; }
  renderMain();
}

function renderLogin() {
  document.getElementById('app').innerHTML = \`
    <div class="login-wrap">
      <div class="login-card">
        <div class="login-title">🎬 Sneak Peek</div>
        <div class="login-sub">Панель администратора</div>
        <div class="form-group">
          <label>Код доступа</label>
          <input id="accessCode" type="text" placeholder="Введите код из лога сервера" autocomplete="off" style="text-transform:uppercase;letter-spacing:2px" onkeydown="if(event.key==='Enter')doLogin()">
        </div>
        <button class="btn btn-primary" onclick="doLogin()">Войти</button>
        <div class="err" id="lerr"></div>
      </div>
    </div>\`;
  setTimeout(() => document.getElementById('accessCode')?.focus(), 50);
}

async function doLogin() {
  const code = document.getElementById('accessCode')?.value?.trim();
  if (!code) { document.getElementById('lerr').textContent = 'Введите код доступа'; return; }
  try {
    const d = await api('POST', '/api/login', { code });
    SESSION = d.session;
    localStorage.setItem('sneak_session', SESSION);
    renderMain();
  } catch(e) {
    document.getElementById('lerr').textContent = e.message;
  }
}

async function renderMain() {
  document.getElementById('app').innerHTML = \`
    <div class="main-wrap">
      <div class="main-header">
        <h1>🎬 Sneak Peek</h1>
        <button class="btn btn-danger" onclick="logout()">Выйти</button>
      </div>
      <div class="upload-card">
        <h2>Загрузить новое видео</h2>
        <div class="upload-row">
          <div class="form-group"><label>Заголовок *</label><input id="vtitle" placeholder="Название видео" /></div>
        </div>
        <div class="form-group"><label>Описание</label><textarea id="vdesc" placeholder="Описание..."></textarea></div>
        <div class="upload-row">
          <div class="form-group">
            <label>Видео файл *</label>
            <label class="file-label"><input type="file" id="vfile" accept="video/*" onchange="updateLabel(this,'vlabel')" /><span id="vlabel">Выберите видео</span></label>
          </div>
          <div class="form-group">
            <label>Обложка (опционально)</label>
            <label class="file-label"><input type="file" id="tfile" accept="image/*" onchange="updateLabel(this,'tlabel')" /><span id="tlabel">Выберите обложку</span></label>
          </div>
        </div>
        <div class="progress" id="prog"><div class="progress-bar" id="progbar"></div></div>
        <div style="margin-top:14px;"><button class="btn btn-primary" onclick="doUpload()">Загрузить</button></div>
        <div class="err" id="uerr"></div>
      </div>
      <div id="videoList" class="loading">Загрузка...</div>
    </div>\`;
  await loadVideos();
}

function updateLabel(input, labelId) {
  const label = document.getElementById(labelId);
  if (input.files?.[0]) label.textContent = input.files[0].name;
}

async function doUpload() {
  const title = document.getElementById('vtitle').value.trim();
  const desc = document.getElementById('vdesc').value.trim();
  const vf = document.getElementById('vfile').files?.[0];
  if (!title) { document.getElementById('uerr').textContent = 'Введите заголовок'; return; }
  if (!vf) { document.getElementById('uerr').textContent = 'Выберите видео'; return; }
  document.getElementById('uerr').textContent = '';
  const prog = document.getElementById('prog');
  const bar = document.getElementById('progbar');
  prog.style.display = 'block'; bar.style.width = '10%';
  const fd = new FormData();
  fd.append('title', title);
  fd.append('description', desc);
  fd.append('video', vf);
  const tf = document.getElementById('tfile').files?.[0];
  if (tf) fd.append('thumbnail', tf);
  try {
    bar.style.width = '50%';
    await api('POST', '/api/upload', fd, true);
    bar.style.width = '100%';
    setTimeout(() => { prog.style.display = 'none'; bar.style.width = '0'; }, 600);
    document.getElementById('vtitle').value = '';
    document.getElementById('vdesc').value = '';
    await loadVideos();
  } catch(e) {
    document.getElementById('uerr').textContent = e.message;
    prog.style.display = 'none';
  }
}

async function loadVideos() {
  try {
    const list = await api('GET', '/api/list');
    const el = document.getElementById('videoList');
    if (!list.length) { el.innerHTML = '<div class="loading">Нет видео</div>'; return; }
    el.innerHTML = '<div class="video-grid">' + list.map(v => \`
      <div class="video-card" id="vc_\${v.id}">
        <div class="video-thumb">
          \${v.thumbnailUrl ? \`<img src="\${v.thumbnailUrl}" style="width:100%;height:100%;object-fit:cover">\` : '🎬'}
        </div>
        <div class="video-info">
          <h3>\${v.title}</h3>
          \${v.description ? \`<p>\${v.description}</p>\` : ''}
          <div class="video-meta">\${new Date(v.createdAt).toLocaleString('ru-RU')}</div>
          <button class="btn btn-danger" onclick="deleteVideo('\${v.id}')">Удалить</button>
        </div>
      </div>\`).join('') + '</div>';
  } catch(e) {
    if (e.message.includes('401')) { SESSION = ''; localStorage.removeItem('sneak_session'); render(); }
  }
}

async function deleteVideo(id) {
  if (!confirm('Удалить это видео?')) return;
  try { await api('DELETE', '/api/delete/' + id); document.getElementById('vc_' + id)?.remove(); }
  catch(e) { alert(e.message); }
}

function logout() {
  SESSION = ''; localStorage.removeItem('sneak_session');
  renderLogin();
}

render();
</script>
</body>
</html>`);
});

let sneakServer;
if (fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath)) {
  const sslOptions = { key: fs.readFileSync(sslKeyPath), cert: fs.readFileSync(sslCertPath) };
  sneakServer = https.createServer(sslOptions, sneakApp);
} else {
  sneakServer = http.createServer(sneakApp);
}
sneakServer.listen(SNEAK_PEEK_PORT, "0.0.0.0", () => {
  console.log(`[sneak_peek] Сервер запущен на порту ${SNEAK_PEEK_PORT}`);
});

// ─── Порт 6767: Создание новых admin-аккаунтов (с авторизацией по коду) ───────

const ADMIN_CREATOR_PORT = 6767;
const adminCreatorApp = express();
const adminCreatorSessions = new Map();

adminCreatorApp.use(express.json());
adminCreatorApp.use(express.urlencoded({ extended: true }));
adminCreatorApp.use(cors({ origin: "*" }));

function getCreatorSession(req) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/ac_session=([^;]+)/);
  return match ? adminCreatorSessions.get(match[1]) : null;
}

const AC_LOGIN_HTML = () => `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>Omni Admin — Вход</title>
</head>
<body>
<h2>Панель создания admin-аккаунтов</h2>
<p>Введите код доступа из лога сервера:</p>
<form method="POST" action="/login">
  <p><input type="text" name="code" placeholder="КОД ДОСТУПА" required autofocus autocomplete="off" style="text-transform:uppercase;width:400px;padding:8px;font-size:16px;letter-spacing:3px"></p>
  <p><button type="submit" style="padding:8px 24px;font-size:15px">Войти</button></p>
</form>
</body>
</html>`;

const AC_PANEL_HTML = (msg = "") => `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>Omni Admin Creator</title>
</head>
<body>
<h2>Создать новый admin-аккаунт</h2>
${msg ? `<p style="color:${msg.startsWith('✅') ? 'green' : 'red'}">${msg}</p>` : ""}
<form method="POST" action="/create">
  <p>
    <label>Username (мин. 5 символов, только a-z 0-9 _):<br>
    <input type="text" name="username" required minlength="5" maxlength="30" autocomplete="off">
    </label>
  </p>
  <p>
    <label>Password (мин. 8 символов, нужна буква + цифра):<br>
    <input type="password" name="password" required minlength="8">
    </label>
  </p>
  <p>
    <label>Display Name (необязательно):<br>
    <input type="text" name="displayName" maxlength="100">
    </label>
  </p>
  <p>
    <label>Role:<br>
    <select name="role">
      <option value="owner">owner</option>
      <option value="curator">curator</option>
      <option value="creator">creator</option>
    </select>
    </label>
  </p>
  <p><button type="submit" style="padding:8px 24px;font-size:15px">Создать</button></p>
</form>
<hr>
<form method="POST" action="/logout"><button type="submit" style="padding:6px 16px">Выйти</button></form>
</body>
</html>`;

adminCreatorApp.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (!getCreatorSession(req)) return res.send(AC_LOGIN_HTML());
  return res.send(AC_PANEL_HTML());
});

adminCreatorApp.post("/login", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const { code } = req.body;
  if (!code || code.trim().toUpperCase() !== MASTER_ACCESS_CODE) {
    console.log(`[admin_creator] ❌ Неверный код доступа с IP ${req.headers["x-forwarded-for"] || req.socket.remoteAddress}`);
    return res.send(AC_LOGIN_HTML() + `<p style="color:red">Неверный код доступа</p>`);
  }
  const sid = uuidv4();
  adminCreatorSessions.set(sid, { createdAt: Date.now() });
  setTimeout(() => adminCreatorSessions.delete(sid), 12 * 60 * 60 * 1000);
  console.log(`[admin_creator] ✅ Успешный вход по коду доступа`);
  res.setHeader("Set-Cookie", `ac_session=${sid}; Path=/; Max-Age=43200; HttpOnly`);
  return res.redirect("/");
});

adminCreatorApp.post("/logout", (req, res) => {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/ac_session=([^;]+)/);
  if (match) adminCreatorSessions.delete(match[1]);
  res.setHeader("Set-Cookie", "ac_session=; Path=/; Max-Age=0");
  return res.redirect("/");
});

adminCreatorApp.post("/create", async (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (!getCreatorSession(req)) return res.redirect("/");
  try {
    const { username, password, displayName, role } = req.body;
    if (!username?.trim() || !password?.trim()) {
      return res.send(AC_PANEL_HTML("Ошибка: username и password обязательны"));
    }
    const cleanUsername = username.trim().toLowerCase();
    if (cleanUsername.length < 5) return res.send(AC_PANEL_HTML("Ошибка: username слишком короткий"));
    if (!/^[a-z0-9_]+$/.test(cleanUsername)) return res.send(AC_PANEL_HTML("Ошибка: только a-z, 0-9, _"));
    const pw = password.trim();
    if (pw.length < 8) return res.send(AC_PANEL_HTML("Ошибка: пароль слишком короткий"));
    if (!/[a-zA-Z]/.test(pw)) return res.send(AC_PANEL_HTML("Ошибка: в пароле должна быть буква"));
    if (!/[0-9]/.test(pw)) return res.send(AC_PANEL_HTML("Ошибка: в пароле должна быть цифра"));

    const existing = stmts.findUserByUsername.get(cleanUsername);
    if (existing) {
      if (existing.is_admin === 1) return res.send(AC_PANEL_HTML(`✅ @${cleanUsername} уже является admin`));
      const validRoles = ['owner', 'curator', 'creator'];
      const finalRole = validRoles.includes(role) ? role : 'owner';
      db.prepare("UPDATE users SET is_admin = 1, global_role = ? WHERE id = ?").run(finalRole, existing.id);
      ensureAdminPrivileges(existing.id);
      db.prepare("UPDATE users SET coins = ? WHERE id = ?").run(ADMIN_INFINITE_COINS, existing.id);
      console.log(`[admin_creator] @${cleanUsername} повышен до admin (${finalRole})`);
      return res.send(AC_PANEL_HTML(`✅ @${cleanUsername} повышен до admin (роль: ${finalRole})`));
    }

    const hash = await bcrypt.hash(pw, 10);
    const id = uuidv4();
    const dn = (displayName?.trim() || cleanUsername).slice(0, 100);
    const validRoles = ['owner', 'curator', 'creator'];
    const finalRole = validRoles.includes(role) ? role : 'owner';
    db.prepare("INSERT INTO users (id, username, password_hash, display_name, is_admin, global_role) VALUES (?, ?, ?, ?, 1, ?)").run(id, cleanUsername, hash, dn, finalRole);
    ensureAdminPrivileges(id);
    db.prepare("UPDATE users SET coins = ? WHERE id = ?").run(ADMIN_INFINITE_COINS, id);
    console.log(`[admin_creator] Создан admin @${cleanUsername} (${finalRole})`);
    return res.send(AC_PANEL_HTML(`✅ Admin @${cleanUsername} создан (роль: ${finalRole})`));
  } catch (e) {
    console.error("[admin_creator] Ошибка:", e.message);
    return res.send(AC_PANEL_HTML(`Ошибка сервера: ${e.message}`));
  }
});

let adminCreatorServer;
if (fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath)) {
  const sslOptions = { key: fs.readFileSync(sslKeyPath), cert: fs.readFileSync(sslCertPath) };
  adminCreatorServer = https.createServer(sslOptions, adminCreatorApp);
} else {
  adminCreatorServer = http.createServer(adminCreatorApp);
}
adminCreatorServer.listen(ADMIN_CREATOR_PORT, "0.0.0.0", () => {
  console.log(`[admin_creator] Панель создания adminов запущена на порту ${ADMIN_CREATOR_PORT}`);
});
