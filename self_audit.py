#!/usr/bin/env python3
"""Repository-only KPGS gate for the CrisisConnect source contract."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REQUIRED_FILES = (
    "index.html",
    "index.css",
    "app.js",
    "db.js",
    "kpgs_progressive.js",
    "sw.js",
    "manifest.json",
    "offline.html",
    "404.html",
    "kpgs_config.json",
    ".kpgs/site-contract.json",
    "MIGRATION.md",
    "vercel.json",
    "tests/kpgs_progressive.test.mjs",
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
            "All required PWA, progressive-governance, source-authority, and fallback files are present.",
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
    db = (ROOT / "db.js").read_text(encoding="utf-8") if (ROOT / "db.js").is_file() else ""
    worker = (ROOT / "sw.js").read_text(encoding="utf-8") if (ROOT / "sw.js").is_file() else ""
    progressive = (
        (ROOT / "kpgs_progressive.js").read_text(encoding="utf-8")
        if (ROOT / "kpgs_progressive.js").is_file()
        else ""
    )

    checks.append(
        check(
            "pwa-shell-links",
            all(token in index for token in ("index.css", "db.js", "app.js", "manifest.json"))
            and "serviceWorker.register('/sw.js')" in app
            and "'/kpgs_progressive.js'" in worker,
            "The app shell and service worker retain required offline runtime surfaces, including the progressive engine.",
        )
    )
    checks.append(
        check(
            "local-first-persistence",
            "CCDB.putIncident" in app
            and "CCDB.enqueue" in app
            and "CCDB.getAllIncidents" in app
            and "executeProgressiveIncidentUpdate" in db
            and "swfus_projections" in db,
            "User report persistence routes through the local progressive projection path while existing restoration remains intact.",
        )
    )
    checks.append(
        check(
            "canonical-progressive-membrane",
            all(
                token in progressive
                for token in (
                    "kpgs.progressive-update.v1",
                    "#NB",
                    "TELEMETRY",
                    "CLASSIFICATION",
                    "ROUTING",
                    "PROTOCOL_SELECTION",
                    "INVARIANT_AUDIT",
                    "POC_FOC_CHECK",
                    "STATE_UPDATE",
                    "DISTRIBUTION",
                    "transport_grants_authority: false",
                )
            ),
            "The current Introduction-to-MCP stage order and non-authoritative distribution boundary are represented explicitly.",
        )
    )
    checks.append(
        check(
            "no-fabricated-external-sync",
            "type: 'SYNC_COMPLETE'" not in worker
            and "SYNC_HELD_NO_EXTERNAL_SINK" in worker
            and "EXTERNAL_DISTRIBUTION_RECEIPT_REQUIRED" in db
            and "external_dispatch_claimed: false" in db,
            "Executable background sync cannot clear pending work or manufacture an external-dispatch receipt; documentation may still name the forbidden legacy event.",
        )
    )

    passed = all(item["pass"] for item in checks)
    result = {
        "schema": "crisisconnect_repo_audit_v2",
        "verdict": "PASS" if passed else "BLOCK",
        "scope": "repository source, KPGS contract, local SWFUS projection, and anti-FOC sync boundary only",
        "live_domain_verification": "not_run",
        "external_dispatch_verification": "not_run",
        "checks": checks,
    }
    print(json.dumps(result, indent=2))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
