#!/usr/bin/env python3
"""Local design-system generator built from bundled CSV data."""

import argparse
import csv
import json

from core import DATA_DIR, search


REASONING_FILE = "ui-reasoning.csv"
SEARCH_CONFIG = {
    "product": 1,
    "style": 3,
    "color": 2,
    "landing": 2,
    "typography": 2,
}


def _load_reasoning():
    filepath = DATA_DIR / REASONING_FILE
    if not filepath.exists():
        return []
    with filepath.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def _find_reasoning_rule(category, reasoning_rows):
    category_lower = category.lower()
    for row in reasoning_rows:
        candidate = row.get("UI_Category", "").lower()
        if candidate == category_lower:
            return row
    for row in reasoning_rows:
        candidate = row.get("UI_Category", "").lower()
        if candidate and (candidate in category_lower or category_lower in candidate):
            return row
    return {}


def _reasoning_for(category):
    rule = _find_reasoning_rule(category, _load_reasoning())
    if not rule:
        return {
            "pattern": "Hero + Features + CTA",
            "style_priority": ["Minimalism", "Flat Design"],
            "color_mood": "Professional",
            "typography_mood": "Clean",
            "key_effects": "Subtle hover transitions",
            "anti_patterns": "",
            "decision_rules": {},
            "severity": "MEDIUM",
        }

    try:
        decision_rules = json.loads(rule.get("Decision_Rules", "{}"))
    except json.JSONDecodeError:
        decision_rules = {}

    return {
        "pattern": rule.get("Recommended_Pattern", ""),
        "style_priority": [item.strip() for item in rule.get("Style_Priority", "").split("+") if item.strip()],
        "color_mood": rule.get("Color_Mood", ""),
        "typography_mood": rule.get("Typography_Mood", ""),
        "key_effects": rule.get("Key_Effects", ""),
        "anti_patterns": rule.get("Anti_Patterns", ""),
        "decision_rules": decision_rules,
        "severity": rule.get("Severity", "MEDIUM"),
    }


def _results(search_result):
    return search_result.get("results", [])


def _select_best_match(rows, priority_keywords=None, name_field="Style Category"):
    if not rows:
        return {}
    if not priority_keywords:
        return rows[0]

    scored = []
    for row in rows:
        text = " ".join(str(value) for value in row.values()).lower()
        score = 0
        for keyword in priority_keywords:
            keyword_lower = keyword.lower()
            if keyword_lower in row.get(name_field, "").lower():
                score += 10
            elif keyword_lower in text:
                score += 1
        scored.append((score, row))

    scored.sort(key=lambda item: item[0], reverse=True)
    return scored[0][1] if scored[0][0] > 0 else rows[0]


def _search_domains(query, reasoning):
    searches = {}
    for domain, max_results in SEARCH_CONFIG.items():
        domain_query = query
        if domain == "style" and reasoning.get("style_priority"):
            domain_query = f"{query} {' '.join(reasoning['style_priority'][:2])}"
        searches[domain] = search(domain_query, domain=domain, max_results=max_results)
    return searches


def generate_design_system(query, project_name=None):
    product_result = search(query, domain="product", max_results=1)
    product_rows = _results(product_result)
    category = product_rows[0].get("Product Type", "General") if product_rows else "General"

    reasoning = _reasoning_for(category)
    search_results = _search_domains(query, reasoning)
    search_results["product"] = product_result

    best_style = _select_best_match(
        _results(search_results["style"]),
        reasoning.get("style_priority", []),
        name_field="Style Category",
    )
    best_color = _select_best_match(_results(search_results["color"]), [reasoning.get("color_mood", "")], "Product Type")
    best_landing = _select_best_match(_results(search_results["landing"]), [reasoning.get("pattern", "")], "Pattern Name")
    best_typography = _select_best_match(
        _results(search_results["typography"]),
        [reasoning.get("typography_mood", "")],
        "Font Pairing Name",
    )

    style_effects = best_style.get("Effects & Animation", "")
    return {
        "project_name": project_name or query.title(),
        "query": query,
        "category": category,
        "pattern": {
            "name": best_landing.get("Pattern Name", reasoning.get("pattern", "Hero + Features + CTA")),
            "sections": best_landing.get("Section Order", "Hero > Features > CTA"),
            "cta_placement": best_landing.get("Primary CTA Placement", "Above fold"),
            "color_strategy": best_landing.get("Color Strategy", ""),
            "conversion": best_landing.get("Conversion Optimization", ""),
        },
        "style": {
            "name": best_style.get("Style Category", "Minimalism"),
            "type": best_style.get("Type", "General"),
            "keywords": best_style.get("Keywords", ""),
            "effects": style_effects or reasoning.get("key_effects", ""),
            "best_for": best_style.get("Best For", ""),
            "performance": best_style.get("Performance", ""),
            "accessibility": best_style.get("Accessibility", ""),
        },
        "colors": {
            "primary": best_color.get("Primary", "#2563EB"),
            "secondary": best_color.get("Secondary", "#3B82F6"),
            "accent": best_color.get("Accent", "#F97316"),
            "background": best_color.get("Background", "#F8FAFC"),
            "foreground": best_color.get("Foreground", "#1E293B"),
            "border": best_color.get("Border", ""),
            "notes": best_color.get("Notes", ""),
        },
        "typography": {
            "heading": best_typography.get("Heading Font", "Inter"),
            "body": best_typography.get("Body Font", "Inter"),
            "mood": best_typography.get("Mood/Style Keywords", reasoning.get("typography_mood", "")),
            "best_for": best_typography.get("Best For", ""),
            "google_fonts_url": best_typography.get("Google Fonts URL", ""),
            "css_import": best_typography.get("CSS Import", ""),
        },
        "anti_patterns": reasoning.get("anti_patterns", ""),
        "decision_rules": reasoning.get("decision_rules", {}),
        "severity": reasoning.get("severity", "MEDIUM"),
    }


def format_markdown(design_system):
    pattern = design_system["pattern"]
    style = design_system["style"]
    colors = design_system["colors"]
    typography = design_system["typography"]

    lines = [
        f"# Design System: {design_system['project_name']}",
        "",
        f"- Category: {design_system['category']}",
        f"- Pattern: {pattern['name']}",
        f"- Sections: {pattern['sections']}",
        f"- Style: {style['name']}",
        f"- Effects: {style['effects']}",
        f"- Primary color: {colors['primary']}",
        f"- Accent color: {colors['accent']}",
        f"- Typography: {typography['heading']} / {typography['body']}",
    ]
    if design_system.get("anti_patterns"):
        lines.append(f"- Avoid: {design_system['anti_patterns']}")
    return "\n".join(lines) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Search local CSV data and generate a design-system recommendation.")
    parser.add_argument("query", help="Design context, such as 'SaaS dashboard'.")
    parser.add_argument("--project-name", "-p", default=None, help="Optional project name for the result.")
    parser.add_argument("--format", "-f", choices=["json", "markdown"], default="json", help="Print format.")
    args = parser.parse_args(argv)

    result = generate_design_system(args.query, args.project_name)
    if args.format == "markdown":
        print(format_markdown(result), end="")
    else:
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
