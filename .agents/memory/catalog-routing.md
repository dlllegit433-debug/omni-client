---
name: catalog routing
description: How the Omni Catalog is hosted — path on main app, not a separate port.
---

## Decision
Catalog HTML is served at `GET /catalog` on the main Express app (port 3000), NOT as a separate Express instance on a separate port (e.g. 228 or 5345).

**Why:** Direct edits to `.replit` are blocked by the platform. Adding a new port requires the workflows/port-mapping skill. Serving at a path on the existing port avoids this entirely.

**How to apply:** Catalog URL in frontend = `${BASE_URL}/catalog?catalog_token=<token>`. The `/catalog` route serves the full HTML which handles its own auth via `catalog_token` query param or stored JWT in localStorage.
