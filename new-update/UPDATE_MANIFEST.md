# UPDATE_MANIFEST — AgentOS Update History

This file records every update integrated through the `new-update/` staging area.

Each entry is an immutable record of what happened. A new record is appended for every
applied update — existing entries are never edited.

---

## Update 001

- **Date:** 2026-09-06
- **Type:** C: ZIP archive / project bundle — release-validation fixes
- **Source:** `new-update/extracted-code/agentos.zip` (temp_agentos snapshot)
- **Files Added:** _
- **Files Modified:** backend/src/app.ts, supabase/schema.sql, supabase/migrations/001_add_sources_and_usage.sql, .gitignore, AUDIT_REPORT.md, FINAL_RELEASE_REPORT.md
- **Files Removed:** frontend/tsconfig.tsbuildinfo (untracked from git)
- **Dependencies:** _
- **Build Status:** passed — backend typecheck/tests (97/97)/build; frontend tsc --noEmit + next build
- **Integration Status:** applied
- **Notes:** Applied release-validation fixes from the update snapshot: production `trust proxy = 1` in backend/src/app.ts; `create_task` `RETURNING ... INTO` scalar-variable fix and `EXECUTE` revoked from `public, anon, authenticated` in both supabase schema files; `*.tsbuildinfo` added to .gitignore; `frontend/tsconfig.tsbuildinfo` untracked; release-validation docs (AUDIT_REPORT.md §32, FINAL_RELEASE_REPORT.md) updated. The AI Studio Vite applet at the zip root was not imported into the production frontend (separate artifact; per repo rules).

---

<!-- Append new entries below this line. Do not modify completed entries. -->