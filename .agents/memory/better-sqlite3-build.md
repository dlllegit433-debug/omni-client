---
name: better-sqlite3 native build
description: How to compile better-sqlite3 when node_modules are missing in this Replit environment.
---

After `npm install --ignore-scripts`, better-sqlite3's native `.node` binary is missing. Compilation requires Python 3, which is NOT in PATH by default.

**Fix:**
1. Find Python in nix store: `ls /nix/store/ | grep "^[a-z0-9]*-python3-3\." | head -3`
2. Write `.npmrc` with: `python=/nix/store/<hash>-python3-3.x-env/bin/python3`
3. Run `npm rebuild better-sqlite3` (background, takes ~60-90s)
4. Verify: `ls node_modules/better-sqlite3/build/Release/better_sqlite3.node`

**Why:** `npm install --ignore-scripts` skips native build scripts; Python is listed in replit.nix but its nix-store path changes. The known working Python env hash: `0098c9aa3ld5mqxx1rahrijirns923zg-python3-3.9.13-env`.

**How to apply:** Any time `node_modules` are missing (fresh clone, dependency reset, etc.) and server fails with "Could not locate the bindings file" for better-sqlite3.
