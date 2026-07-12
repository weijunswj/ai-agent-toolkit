#!/usr/bin/env python3
"""Parse Codex config TOML with the Python standard-library parser."""

from __future__ import annotations

import json
import sys
import tomllib


def value_summary(table: dict[str, object], key: str) -> dict[str, object]:
    if key not in table:
        return {"present": False}
    value = table[key]
    value_type = "integer" if type(value) is int else type(value).__name__
    summary: dict[str, object] = {"present": True, "type": value_type}
    if type(value) is int:
        summary["value"] = value
    return summary


def main() -> int:
    raw = sys.stdin.buffer.read()
    try:
        text = raw.decode("utf-8")
        parsed = tomllib.loads(text)
    except (UnicodeDecodeError, tomllib.TOMLDecodeError) as error:
        print(json.dumps({"ok": False, "error": str(error)}))
        return 0

    agents_present = "agents" in parsed
    agents = parsed.get("agents")
    agents_is_table = isinstance(agents, dict)
    table = agents if agents_is_table else {}
    print(json.dumps({
        "ok": True,
        "agents_present": agents_present,
        "agents_is_table": agents_is_table,
        "max_threads": value_summary(table, "max_threads"),
        "max_depth": value_summary(table, "max_depth"),
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
