# Physicians Portal

This folder contains a separate physician-facing webapp shell.

It is served by the main Express app at `/physicians-portal/` and uses the shared placeholder real-time consultation endpoints:

- `GET /api/consultation/history`
- `GET /api/consultation/stream`
- `POST /api/consultation/messages`

Current behavior is intentionally lightweight and in-memory so dispatcher-to-physician handoff can be demonstrated without a production socket backend.
