---
name: server.js corruption guard
description: How to detect and recover from server.js file corruption caused by large edit operations.
---

## The Problem
Using the `edit` tool with a very large `new_string` (thousands of characters, especially containing template literals with embedded JS/HTML) can corrupt server.js, leaving only the tail of the new content (~172 lines) instead of the full file.

## Detection
- `wc -l server.js` returns unexpectedly small number (e.g. 172 instead of 4300+)
- File starts in the middle of a string literal

## Recovery
```bash
git --no-optional-locks log --oneline server.js  # find last good commit
git --no-optional-locks show <commit>:server.js > server.js  # restore
```

**Why:** The edit tool has a size limit on new_string. When exceeded, only the tail is written.

**How to apply:** When adding large HTML blocks to server.js, split into multiple smaller edits. Keep each new_string under ~3000 characters.
