#!/usr/bin/env python3
"""
AgentOS Update Tool
===================

Safely integrate new code placed in the `new-update/` staging area into the
existing AgentOS project. It NEVER overwrites the live project silently.

Workflow implemented here:
    Scan new-update -> Detect type -> Inspect files -> Compare with existing
    project -> Identify additions/modifications/conflicts -> Create integration
    plan -> Apply safe changes (with backups) -> Report result.

Usage:
    python new-update/update_tool.py inspect --source <path-to-update>
    python new-update/update_tool.py plan   --source <path-to-update>
    python new-update/update_tool.py apply
    python new-update/update_tool.py run    --source <path-to-update>   (plan + apply)
    python new-update/update_tool.py plan   --list-conflicts

Exit codes:
    0  success
    1  error / invalid usage
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import os
import re
import shutil
import sys
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

ROOT = Path(__file__).resolve().parent.parent          # AgentOS project root
STAGING = ROOT / "new-update"                          # this staging area
EXTRACT_DIR = STAGING / "extracted-code"               # extracted ZIP destination
BACKUP_DIR = STAGING / "backups"                       # safety snapshots
PLAN_FILE = STAGING / "UPDATE_PLAN.json"               # machine-readable plan
PLAN_MD_FILE = STAGING / "UPDATE_PLAN.md"              # human-readable plan
MANIFEST_FILE = STAGING / "UPDATE_MANIFEST.md"         # record of applied updates

# Package files to compare for dependency protection.
PACKAGE_FILES = {"package.json"}
IGNORED_NAMES: Set[str] = {
    ".env", ".env.local", ".env.development", ".env.production", ".env.any",
    "node_modules", ".git", ".next", "dist", "build", "coverage", "out",
    ".DS_Store", "thumbs.db",
}
IGNORED_SUFFIXES: Tuple[str, ...] = (
    ".tsbuildinfo",
)
# Content sentinels that strongly indicate secrets - treat file as config/skip.
SECRET_PATTERNS = [
    re.compile(r"(?i)(api[_-]?key|secret|password|token|private[_-]?key)\s*[=:]\s*['\"][A-Za-z0-9_\-\.]{8,}['\"]"),
    re.compile(r"(?i)supabase[_-]?service[_-]?role[_-]?key\s*[=:]"),
]

# Package files to compare for dependency protection.
PACKAGE_FILES = {"package.json"}


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _now() -> str:
    return _dt.datetime.now().isoformat(timespec="seconds")


def _rel(path: Path) -> str:
    """Project-root-relative posix path."""
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def is_ignored_name(name: str) -> bool:
    return name in IGNORED_NAMES or any(name.endswith(s) for s in IGNORED_SUFFIXES)


def is_secret_file(path: Path) -> bool:
    """Heuristic: does this file look like it holds secrets/config we should not import?"""
    try:
        head = path.read_text(encoding="utf-8", errors="ignore")[:4000]
    except OSError:
        return False
    return any(p.search(head) for p in SECRET_PATTERNS)


def file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def read_staging_plan() -> Optional[Dict]:
    if not PLAN_FILE.exists():
        return None
    try:
        return json.loads(PLAN_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def write_staging_plan(plan: Dict) -> None:
    PLAN_FILE.write_text(
        json.dumps(plan, indent=2, ensure_ascii=False), encoding="utf-8"
    )


# --------------------------------------------------------------------------- #
# 1. Detect + inspect
# --------------------------------------------------------------------------- #

def collect_incoming_files(source: Path) -> List[Path]:
    """Return all importable files under `source`, skipping ignored names/secrets."""
    if not source.exists():
        raise FileNotFoundError(f"Source not found: {source}")
    files: List[Path] = []
    for p in sorted(source.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(source)
        if any(part in IGNORED_NAMES or part in IGNORED_NAMES for part in rel.parts):
            continue
        if is_secret_file(p):
            print(f"  [skip secret] {rel}")
            continue
        files.append(p)
    return files


def detect_type(incoming: List[Path], had_zip: bool) -> str:
    """Best-effort classification of the update."""
    root_files = {p.name for p in incoming}
    names = {p.name for p in incoming}
    if "package.json" in root_files and "frontend" not in root_files and "backend" not in root_files:
        return "D: complete replacement / full project"
    if had_zip:
        if "package.json" not in names:
            return "B: ZIP - UI / partial update"
        return "C: ZIP archive / project bundle"
    if any(p.parent == incoming and p.suffix.lower() in (".tsx", ".ts", ".jsx", ".js", ".css")
           for p in incoming):
        return "A: new feature / component(s)"
    return "B: UI / partial update"


def inspect_source(source: Path, extract: bool = True) -> Dict:
    """Return a descriptor of what the update contains and where files live."""
    incoming: List[Path] = []
    had_zip = False
    zip_paths: List[Path] = []

    if source.is_file() and source.suffix.lower() == ".zip":
        had_zip = True
        zip_paths.append(source)
        target = EXTRACT_DIR / source.stem
        if extract:
            if target.exists():
                shutil.rmtree(target)
            target.mkdir(parents=True, exist_ok=True)
            try:
                with zipfile.ZipFile(source) as zf:
                    for member in zf.namelist():
                        # Zip-slip protection: never write outside target.
                        dest = (target / member).resolve()
                        if not str(dest).startswith(str(target.resolve())):
                            print(f"  [zip-slip blocked] {member}")
                            continue
                        zf.extract(member, target)
            except zipfile.BadZipFile as e:
                raise ValueError(f"Invalid ZIP: {e}")
            incoming = collect_incoming_files(target)
            print(f"  Extracted {len(incoming)} files -> {_rel(target)}")
        else:
            incoming = []
    elif source.is_dir():
        incoming = collect_incoming_files(source)
    else:
        raise FileNotFoundError(f"Source is neither a file nor a folder: {source}")

    return {
        "source": _rel(source),
        "had_zip": had_zip,
        "zip_paths": [_rel(z) for z in zip_paths],
        "incoming_files": [_rel(f) for f in incoming],
        "type": detect_type(incoming, had_zip),
    }


# --------------------------------------------------------------------------- #
# 2. File mapping
# --------------------------------------------------------------------------- #

def strip_known_prefix(rel: str) -> str:
    """Remove redundant prefixes so we map to the real project location."""
    parts = list(Path(rel).parts)
    # Drop leading staging containers.
    while parts and parts[0] in ("new-update", "extracted-code", "test-feature"):
        parts = parts[1:]
    # If a frontend/backend/supabase subfolder is nested (e.g. frontend/frontend
    # from a full-project archive), collapse the duplicate level.
    if parts and parts[0] in ("frontend", "backend", "supabase") and len(parts) >= 2 \
            and parts[1] == parts[0]:
        parts = parts[1:]
    return "/".join(parts) if parts else rel


def map_to_project(rel: str) -> str:
    """Map an incoming (root-relative) path to its destination in the project."""
    rel = strip_known_prefix(rel)
    parts = Path(rel).parts

    if not parts:
        return rel

    first = parts[0]

    # Known project root files.
    if first in ("README.md", "render.yaml") or rel == "package.json":
        return rel

    # Already under a real target dir (frontend/…, backend/…, supabase/…).
    if first in ("frontend", "backend", "supabase"):
        return rel

    # A package.json at top level without a target dir -> keep at root so the
    # dependency comparison is shown and reviewed.
    if rel.endswith("package.json"):
        return rel

    # Frontend-style files -> assume they belong under frontend/.
    if parts[-1].endswith((".tsx", ".ts", ".jsx", ".css", ".scss")) \
            or parts[0] in ("app", "components", "lib", "public", "styles"):
        return "frontend/" + rel

    # Unknown layout - keep as-is so the reviewer decides.
    return rel


# --------------------------------------------------------------------------- #
# 3. Compare with existing project
# --------------------------------------------------------------------------- #

def classify_file(incoming: Path, mapped_rel: str) -> Dict:
    """Classify one incoming file as added / modified / conflict."""
    dest = ROOT / mapped_rel
    rec = {
        "incoming": _rel(incoming),
        "path": mapped_rel,
        "status": "added",          # added | modified | conflict
        "incoming_hash": file_hash(incoming),
        "existing_hash": None,
        "dont_apply": False,
        "note": "",
    }
    if not dest.exists():
        rec["status"] = "added"
        rec["note"] = "new file with no existing counterpart"
        return rec

    rec["existing_hash"] = file_hash(dest)
    if rec["existing_hash"] == rec["incoming_hash"]:
        rec["status"] = "skipped"
        rec["note"] = "identical to existing file - no change needed"
        return rec

    if is_secret_file(incoming):
        rec["status"] = "conflict"
        rec["note"] = "incoming file looks like config/secrets; needs review"
        return rec

    # The file already exists and differs -> modification (or conflict when it is
    # a protected area that must never be auto-overwritten).
    if _is_protected(dest):
        rec["status"] = "conflict"
        rec["note"] = "protected area; manual merge required"
    else:
        rec["status"] = "modified"
        rec["note"] = "existing file with different content"
    return rec


def _is_protected(dest: Path) -> bool:
    """Paths where we never auto-overwrite - always require human review."""
    rel = _rel(dest)
    protected_roots = (
        "backend/src/middleware/",          # auth
        "backend/src/routes/",              # API routes
        "backend/src/lib/taskStore",        # database logic
        "backend/src/lib/config",           # env validation
        "backend/src/agent/",               # research execution
        "backend/src/tools/",               # source retrieval
        "supabase/",                        # database schema
    )
    return rel.startswith(protected_roots)


# --------------------------------------------------------------------------- #
# 4. Dependency comparison
# --------------------------------------------------------------------------- #

def parse_package(path: Path) -> Optional[Dict]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def compare_dependencies(incoming: Path, mapped_rel: str) -> Optional[Dict]:
    """Compare package.json with existing project package.json."""
    dest = ROOT / mapped_rel
    if not dest.exists():
        return {"added": True, "summary": "new package.json - dependency set must be reviewed"}
    inc = parse_package(incoming)
    exi = parse_package(dest)
    if not inc or not exi:
        return {"added": False, "summary": "could not parse package.json"}
    added: Dict[str, str] = {}
    removed: Dict[str, str] = {}
    changed: Dict[str, Tuple[str, str]] = {}
    for section in ("dependencies", "devDependencies"):
        ideps = inc.get(section, {}) if inc.get(section) else {}
        edeps = exi.get(section, {}) if exi.get(section) else {}
        for name, ver in ideps.items():
            if name not in edeps:
                added[name] = ver
            elif edeps[name] != ver:
                changed[name] = (edeps[name], ver)
        for name in edeps:
            if name not in ideps:
                removed[name] = edeps[name]
    return {
        "added": False,
        "added_deps": added,
        "removed_deps": removed,
        "changed_deps": changed,
    }


# --------------------------------------------------------------------------- #
# 5. Build the integration plan
# --------------------------------------------------------------------------- #

def build_plan(source: Path, plan_name: Optional[str]) -> Dict:
    if not source.exists():
        print(f"ERROR: source not found: {source}")
        sys.exit(1)
    descriptor = inspect_source(source)

    # Root directory the incoming files were collected from (folder root, or the
    # ZIP extraction target). Used to compute source-relative mapping paths.
    if descriptor["had_zip"]:
        base_resolv = EXTRACT_DIR.resolve()
    else:
        base_resolv = source.resolve()

    src_rels: List[str] = []
    for el in descriptor["incoming_files"]:
        p = (ROOT / el).resolve()
        try:
            src_rels.append(p.relative_to(base_resolv).as_posix())
        except ValueError:
            src_rels.append(_rel(p))

    # For a ZIP that unwraps into a single top-level folder (the common case:
    # agentos-ui-update/ui/...), collapse that redundant stem so files land
    # directly where they belong.
    prefix_to_strip = ""
    if descriptor["had_zip"] and src_rels:
        tops = {r.split("/", 1)[0] for r in src_rels}
        if len(tops) == 1:
            prefix_to_strip = next(iter(tops)) + "/"

    files: List[Dict] = []
    dependencies: List[Dict] = []

    for p, src_rel in zip(
        [(ROOT / el).resolve() for el in descriptor["incoming_files"]],
        src_rels,
    ):
        if prefix_to_strip:
            mapped = map_to_project(src_rel[len(prefix_to_strip):])
        else:
            mapped = map_to_project(src_rel)
        rec = classify_file(p, mapped)
        if rec["status"] == "skipped":
            continue
        # Re-record the incoming path so indexing is stable for apply.
        rec["incoming"] = _rel(p)
        files.append(rec)
        if Path(src_rel).name in PACKAGE_FILES:
            dep = compare_dependencies(p, mapped)
            if dep:
                dependencies.append({"path": mapped, **dep})

    plan = {
        "name": plan_name or "Unnamed update",
        "generated_at": _now(),
        "source": descriptor["source"],
        "type": descriptor["type"],
        "had_zip": descriptor["had_zip"],
        "classifications": files,
        "dependencies": dependencies,
        "ignored": sorted(
            p for p in descriptor["incoming_files"]
            if False
        ),
    }
    write_staging_plan(plan)
    return plan


# --------------------------------------------------------------------------- #
# 6. Plan rendering (human-readable)
# --------------------------------------------------------------------------- #

def render_plan_md(plan: Dict) -> str:
    lines: List[str] = []
    lines.append(f"# Integration Plan - {plan['name']}")
    lines.append("")
    lines.append(f"- Source: `{plan['source']}`  ({plan['type']})")
    lines.append(f"- Generated: {plan['generated_at']}")
    lines.append("")
    files = plan["classifications"]
    added = [f for f in files if f["status"] == "added"]
    modified = [f for f in files if f["status"] == "modified"]
    conflicts = [f for f in files if f["status"] == "conflict"]
    lines.append("## Summary")
    lines.append("")
    lines.append(f"- New: {len(added)}")
    lines.append(f"- Modified: {len(modified)}")
    lines.append(f"- Conflicts: {len(conflicts)}")
    lines.append(f"- Dependencies: {len(plan['dependencies'])}")
    lines.append("")

    for label, status, subset in (
        ("Added", "+", added),
        ("Modified", "~", modified),
        ("Conflicts", "!", conflicts),
    ):
        if not subset:
            continue
        lines.append(f"## {label}")
        lines.append("")
        for f in subset:
            flag = "!" if f["dont_apply"] else ""
            lines.append(f"`{status} {f['path']}`  _{f['note']}_{flag}")
        lines.append("")

    if plan["dependencies"]:
        lines.append("## Dependencies")
        lines.append("")
        for d in plan["dependencies"]:
            lines.append(f"`{d['path']}`")
            if d.get("added"):
                lines.append("  - brand-new package.json - review the full set")
            if d.get("added_deps"):
                lines.append("  - added: " + ", ".join(f"{k}@{v}" for k, v in d["added_deps"].items()))
            if d.get("removed_deps"):
                lines.append("  - removed: " + ", ".join(f"{k}@{v}" for k, v in d["removed_deps"].items()))
            if d.get("changed_deps"):
                lines.append("  - changed: " + ", ".join(f"{k} {a}->{b}" for k, (a, b) in d["changed_deps"].items()))
        lines.append("")

    lines.append("## Notes")
    lines.append("")
    lines.append("- `!` conflicts are NEVER auto-applied; review and merge manually.")
    lines.append("- Sensitive/config files are skipped and listed as conflicts.")
    lines.append("")
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# 7. Apply
# --------------------------------------------------------------------------- #

def apply_plan() -> Tuple[Dict, List[str]]:
    plan = read_staging_plan()
    if not plan:
        print("No plan found. Run `plan` first.")
        sys.exit(1)

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    run_stamp = _dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    run_backup = BACKUP_DIR / run_stamp
    run_backup.mkdir(parents=True, exist_ok=True)
    applied: List[Dict] = []
    errors: List[str] = []

    for rec in plan["classifications"]:
        if rec.get("dont_apply"):
            print(f"  [skipped by review] {rec['path']}")
            continue
        dest = ROOT / rec["path"]
        incoming = ROOT / rec["incoming"]
        if not incoming.exists():
            errors.append(f"missing incoming file {rec['incoming']}")
            continue

        if rec["status"] == "conflict":
            errors.append(f"conflict not applied (requires review): {rec['path']}")
            continue

        # Backup the existing file before modifying/removing.
        if dest.exists():
            backup_dir = run_backup / rec["path"].replace("/", os.sep)
            backup_dir.mkdir(parents=True, exist_ok=True)
            try:
                shutil.copy2(dest, backup_dir / dest.name)
            except OSError as e:
                errors.append(f"backup failed for {rec['path']}: {e}")
                continue

        try:
            if rec["status"] == "added":
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(incoming, dest)
            elif rec["status"] == "modified":
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(incoming, dest)
            applied.append(rec)
        except OSError as e:
            errors.append(f"apply failed for {rec['path']}: {e}")

    plan["applied_at"] = _now()
    plan["applied"] = applied
    plan["errors"] = errors
    plan["integration_status"] = "applied" if not errors else "applied-with-errors"
    write_staging_plan(plan)

    if applied:
        _append_manifest(plan, applied)
    return plan, errors


def _append_manifest(plan: Dict, applied: List[Dict]) -> None:
    """Append a new Update entry to UPDATE_MANIFEST.md."""
    added = [r["path"] for r in applied if r["status"] == "added"]
    modified = [r["path"] for r in applied if r["status"] == "modified"]
    conflicts = [r["path"] for r in plan["classifications"] if r["status"] == "conflict"]
    deps: List[str] = []
    for d in plan.get("dependencies", []):
        if d.get("added_deps"):
            deps.extend(f"{k}@{v}" for k, v in d["added_deps"].items())

    num = 0
    text = MANIFEST_FILE.read_text(encoding="utf-8") if MANIFEST_FILE.exists() else ""
    for m in re.finditer(r"^## Update (\d+)$", text, re.M):
        num = max(num, int(m.group(1)))

    entry = (
        "\n---\n\n"
        f"## Update {num + 1:03d}\n\n"
        f"- **Date:** {_now()}\n"
        f"- **Type:** {plan.get('type', '')}\n"
        f"- **Source:** `{plan.get('source', '')}`\n"
        f"- **Files Added:** {', '.join(added) if added else '_'}\n"
        f"- **Files Modified:** {', '.join(modified) if modified else '_'}\n"
        f"- **Files Removed:** _\n"
        f"- **Dependencies:** {', '.join(deps) if deps else '_'}\n"
        f"- **Build Status:** _pending - run typecheck + build + tests_\n"
        f"- **Integration Status:** {plan.get('integration_status', 'applied')}\n"
        f"- **Notes:** generated automatically by new-update/update_tool.py\n"
    )
    marker = "<!-- Append new entries below this line. Do not modify completed entries. -->"
    if marker in text:
        text = text.replace(marker, marker + "\n" + entry)
    else:
        text += entry
    MANIFEST_FILE.write_text(text, encoding="utf-8")


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def cmd_inspect(args) -> int:
    desc = inspect_source(Path(args.source), extract=args.extract)
    print(f"\nUpdate source: {desc['source']}")
    print(f"Type: {desc['type']}")
    print(f"ZIP: {desc['had_zip']}")
    print(f"Files: {len(desc['incoming_files'])}")
    for f in desc["incoming_files"]:
        print("  -", f)
    return 0


def cmd_plan(args) -> int:
    # --list-conflicts reads an existing plan instead of generating.
    if args.list_conflicts:
        plan = read_staging_plan()
        if not plan:
            print("No plan found.")
            return 1
        conflicts = [f for f in plan["classifications"] if f["status"] == "conflict"]
        print(f"Conflicts: {len(conflicts)}")
        for c in conflicts:
            print(f"  ! {c['path']} - {c['note']}")
        return 0

    source = Path(args.source)
    plan = build_plan(source, args.name)
    PLAN_MD_FILE.write_text(render_plan_md(plan), encoding="utf-8")

    added = [f for f in plan["classifications"] if f["status"] == "added"]
    mod = [f for f in plan["classifications"] if f["status"] == "modified"]
    conflicts = [f for f in plan["classifications"] if f["status"] == "conflict"]

    print(f"\nUpdate detected - {plan['source']} ({plan['type']})")
    print(f"  Files:  {len(plan['classifications'])}")
    print(f"  New:    {len(added)}")
    print(f"  Modified: {len(mod)}")
    print(f"  Conflicts: {len(conflicts)}")
    print(f"  Dependencies: {len(plan['dependencies'])}")
    print()
    print("Review layout saved to:", _rel(PLAN_MD_FILE))
    print()
    for f in plan["classifications"]:
        if f["status"] == "added":
            print(f"+ {f['path']}")
        elif f["status"] == "modified":
            print(f"~ {f['path']}")
        elif f["status"] == "conflict":
            print(f"! {f['path']}  ({f['note']})")
    print()
    mods = len(mod)
    conflicts_n = len(conflicts)
    print(f"Run `apply` to apply {len(added) + mods} safe, non-conflicting change(s).")
    print(f"{conflicts_n} conflict(s) require manual review and will be skipped by apply.")
    return 0


def cmd_apply(args) -> int:
    plan, errors = apply_plan()
    applied = plan.get("applied", [])
    print(f"\nApplied {len(applied)} change(s).")
    for r in applied:
        print(f"  {'+' if r['status']=='added' else '~'} {r['path']}  (backup saved)")
    if errors:
        print("\nErrors / skipped (not applied):")
        for e in errors:
            print(f"  ! {e}")
    print("\nManifest updated: new-update/UPDATE_MANIFEST.md")
    print("\nNEXT: run typecheck + lint + production build, and verify affected flows.")
    return 0


def cmd_run(args) -> int:
    source = Path(args.source)
    plan = build_plan(source, args.name)
    # Don't auto-apply conflicts. Print the review, apply safe changes.
    PLAN_MD_FILE.write_text(render_plan_md(plan), encoding="utf-8")
    print()
    for f in plan["classifications"]:
        status = f["status"]
        icon = {"added": "+", "modified": "~", "conflict": "!"}.get(status, "?")
        print(f"{icon} {f['path']}  ({f['note']})")
    print()
    return cmd_apply(args)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="new-update/update_tool.py",
                                     description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p_inspect = sub.add_parser("inspect", help="scan the update and list its files")
    p_inspect.add_argument("--source", default=str(STAGING))
    p_inspect.add_argument("--no-extract", dest="extract", action="store_false", default=True)
    p_inspect.set_defaults(func=cmd_inspect)

    p_plan = sub.add_parser("plan", help="compare update with project and write an integration plan")
    p_plan.add_argument("--source", default=str(STAGING))
    p_plan.add_argument("--name", default=None)
    p_plan.add_argument("--list-conflicts", action="store_true", help="print conflicts of existing plan")
    p_plan.set_defaults(func=cmd_plan)

    p_apply = sub.add_parser("apply", help="apply the safe, non-conflicting approved changes")
    p_apply.set_defaults(func=cmd_apply)

    p_run = sub.add_parser("run", help="plan + apply (skips conflicts)")
    p_run.add_argument("--source", default=str(STAGING))
    p_run.add_argument("--name", default=None)
    p_run.set_defaults(func=cmd_run)

    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except KeyboardInterrupt:
        print("\nAborted.")
        return 130
    except (FileNotFoundError, ValueError) as e:
        print(f"ERROR: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
