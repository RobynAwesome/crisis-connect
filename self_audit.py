#!/usr/bin/env python3
"""Repository-only KPGS gate for the CrisisConnect source contract."""

from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REQUIRED_FILES = (
    "index.html",
    "index.css",
    "app.js",
    "db.js",
    "sw.js",
    "manifest.json",
    "offline.html",
    "404.html",
    "kpgs_config.json",
    ".kpgs/site-contract.json",
    "MIGRATION.md",
    "vercel.json",
)


def load_json(relative_path: str) -> dict:
    return json.loads((ROOT / relative_path).read_text(encoding="utf-8"))


def check(label: str, condition: bool, detail: str) -> dict:
    return {"label": label, "pass": bool(condition), "detail": detail}


def main() -> int:
    checks: list[dict] = []
    checks.append(
        check(
            "required-files",
            all((ROOT / path).is_file() for path in REQUIRED_FILES),
            "All required PWA, source-authority, and fallback files are present.",
        )
    )

    try:
        config = load_json("kpgs_config.json")
        contract = load_json(".kpgs/site-contract.json")
    except (OSError, json.JSONDecodeError) as exc:
        checks.append(check("valid-json", False, str(exc)))
    else:
        checks.append(check("valid-json", True, "KPGS configuration and site contract parse."))
        checks.append(
            check(
                "canonical-repository",
                config.get("github_repo") == "https://github.com/RobynAwesome/crisis-connect"
                and contract.get("source", {}).get("repository") == "RobynAwesome/crisis-connect"
                and contract.get("source", {}).get("branch") == "main",
                "KPGS configuration and contract agree on the canonical source.",
            )
        )
        checks.append(
            check(
                "domain-contract",
                config.get("vercel_url") == "https://crisisconnect.kopanolabs.com"
                and contract.get("domain") == "crisisconnect.kopanolabs.com"
                and contract.get("deployment", {}).get("provider") == "vercel"
                and contract.get("deployment", {}).get("source_switch") == "pending"
                and contract.get("deployment", {}).get("live_domain_changed_by_this_contract") is False,
                "The Vercel target is declared without falsely claiming that this migration deployed it.",
            )
        )
        observed = contract.get("deployment", {}).get("observed_live", {})
        checks.append(
            check(
                "observed-live-route",
                observed.get("edge") == "cloudflare"
                and observed.get("upstream_hint") == "caddy"
                and observed.get("status") == 200,
                "The current Cloudflare-to-Caddy route is recorded separately from the intended Vercel target.",
            )
        )
        checks.append(
            check(
                "critical-service-motion-policy",
                contract.get("experience", {}).get("mode") == "critical-service"
                and contract.get("experience", {}).get("motion") == "essential-only"
                and contract.get("experience", {}).get("offline_fallback") == "offline.html"
                and contract.get("experience", {}).get("not_found_fallback") == "404.html",
                "Critical flows retain static, offline, and recovery paths.",
            )
        )

    index = (ROOT / "index.html").read_text(encoding="utf-8") if (ROOT / "index.html").is_file() else ""
    app = (ROOT / "app.js").read_text(encoding="utf-8") if (ROOT / "app.js").is_file() else ""
    worker = (ROOT / "sw.js").read_text(encoding="utf-8") if (ROOT / "sw.js").is_file() else ""
    checks.append(
        check(
            "pwa-shell-links",
            all(token in index for token in ("index.css", "db.js", "app.js", "manifest.json"))
            and "serviceWorker.register('/sw.js')" in app,
            "The app shell declares CSS, JavaScript, manifest, and service-worker registration.",
        )
    )
    checks.append(
        check(
            "local-first-persistence",
            "CCDB.putIncident" in app
            and "CCDB.enqueue" in app
            and "CCDB.getAllIncidents" in app
            and "'/db.js'" in worker,
            "Reports, offline queue, incident restoration, and the service-worker shell use IndexedDB.",
        )
    )

    passed = all(item["pass"] for item in checks)
    result = {
        "schema": "crisisconnect_repo_audit_v1",
        "verdict": "PASS" if passed else "BLOCK",
        "scope": "repository source and KPGS contract only",
        "live_domain_verification": "not_run",
        "checks": checks,
    }
    print(json.dumps(result, indent=2))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
