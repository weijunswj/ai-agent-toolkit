#!/usr/bin/env python3
"""Local CSV search for design-system recommendations."""

import csv
import re
from collections import defaultdict
from math import log
from pathlib import Path


DATA_DIR = Path(__file__).resolve().parents[1] / "data"
MAX_RESULTS = 3

CSV_CONFIG = {
    "product": {
        "file": "products.csv",
        "search_cols": ["Product Type", "Keywords", "Primary Style Recommendation", "Key Considerations"],
    },
    "style": {
        "file": "styles.csv",
        "search_cols": ["Style Category", "Keywords", "Best For", "Type", "AI Prompt Keywords"],
    },
    "color": {
        "file": "colors.csv",
        "search_cols": ["Product Type", "Notes"],
    },
    "landing": {
        "file": "landing.csv",
        "search_cols": ["Pattern Name", "Keywords", "Conversion Optimization", "Section Order"],
    },
    "typography": {
        "file": "typography.csv",
        "search_cols": ["Font Pairing Name", "Category", "Mood/Style Keywords", "Best For", "Heading Font", "Body Font"],
    },
    "chart": {
        "file": "charts.csv",
        "search_cols": ["Data Type", "Keywords", "Best Chart Type", "When to Use", "When NOT to Use", "Accessibility Notes"],
    },
    "ux": {
        "file": "ux-guidelines.csv",
        "search_cols": ["Category", "Issue", "Description", "Platform", "Do", "Don't"],
    },
    "icons": {
        "file": "icons.csv",
        "search_cols": ["Category", "Icon Name", "Keywords", "Best For", "Library"],
    },
    "react": {
        "file": "react-performance.csv",
        "search_cols": ["Category", "Issue", "Keywords", "Description", "Do", "Don't"],
    },
    "web": {
        "file": "app-interface.csv",
        "search_cols": ["Category", "Issue", "Keywords", "Description", "Do", "Don't"],
    },
    "google-fonts": {
        "file": "google-fonts.csv",
        "search_cols": ["Family", "Category", "Stroke", "Classifications", "Keywords", "Subsets", "Designers"],
    },
}

STACK_CONFIG = {
    "react": "stacks/react.csv",
    "nextjs": "stacks/nextjs.csv",
    "vue": "stacks/vue.csv",
    "svelte": "stacks/svelte.csv",
    "astro": "stacks/astro.csv",
    "swiftui": "stacks/swiftui.csv",
    "react-native": "stacks/react-native.csv",
    "flutter": "stacks/flutter.csv",
    "nuxtjs": "stacks/nuxtjs.csv",
    "nuxt-ui": "stacks/nuxt-ui.csv",
    "html-tailwind": "stacks/html-tailwind.csv",
    "shadcn": "stacks/shadcn.csv",
    "jetpack-compose": "stacks/jetpack-compose.csv",
    "threejs": "stacks/threejs.csv",
    "angular": "stacks/angular.csv",
    "laravel": "stacks/laravel.csv",
}

STACK_SEARCH_COLS = ["Category", "Guideline", "Description", "Do", "Don't"]

DOMAIN_KEYWORDS = {
    "product": [
        "saas",
        "dashboard",
        "ecommerce",
        "fintech",
        "healthcare",
        "portfolio",
        "crm",
        "marketplace",
        "booking",
    ],
    "style": ["style", "design", "ui", "minimal", "glass", "brutal", "flat", "tailwind"],
    "color": ["color", "palette", "brand", "accent", "background", "foreground"],
    "landing": ["landing", "hero", "cta", "pricing", "testimonial", "conversion"],
    "typography": ["font", "typography", "serif", "sans", "heading", "body"],
    "chart": ["chart", "graph", "visualization", "trend", "bar", "pie", "scatter", "heatmap"],
    "ux": ["ux", "accessibility", "wcag", "navigation", "keyboard", "animation", "responsive"],
    "icons": ["icon", "icons", "lucide", "heroicons", "symbol", "glyph"],
    "react": ["react", "nextjs", "next.js", "suspense", "memo", "bundle", "server component"],
    "web": ["aria", "focus", "semantic", "form", "input", "autocomplete"],
    "google-fonts": ["google font", "font family", "variable font", "noto", "monospace"],
}


class BM25:
    """Small BM25 ranker for local CSV rows."""

    def __init__(self, k1=1.5, b=0.75):
        self.k1 = k1
        self.b = b
        self.corpus = []
        self.doc_lengths = []
        self.avgdl = 0
        self.idf = {}
        self.doc_freqs = defaultdict(int)

    def tokenize(self, text):
        cleaned = re.sub(r"[^\w\s]", " ", str(text).lower())
        return [word for word in cleaned.split() if len(word) > 2]

    def fit(self, documents):
        self.corpus = [self.tokenize(document) for document in documents]
        if not self.corpus:
            return

        self.doc_lengths = [len(document) for document in self.corpus]
        self.avgdl = sum(self.doc_lengths) / len(self.doc_lengths)

        for document in self.corpus:
            for word in set(document):
                self.doc_freqs[word] += 1

        total = len(self.corpus)
        for word, frequency in self.doc_freqs.items():
            self.idf[word] = log((total - frequency + 0.5) / (frequency + 0.5) + 1)

    def score(self, query):
        query_tokens = self.tokenize(query)
        scores = []

        for index, document in enumerate(self.corpus):
            score = 0
            term_freqs = defaultdict(int)
            for word in document:
                term_freqs[word] += 1

            for token in query_tokens:
                if token not in self.idf:
                    continue
                term_frequency = term_freqs[token]
                numerator = term_frequency * (self.k1 + 1)
                denominator = term_frequency + self.k1 * (
                    1 - self.b + self.b * self.doc_lengths[index] / self.avgdl
                )
                score += self.idf[token] * numerator / denominator

            scores.append((index, score))

        return sorted(scores, key=lambda item: item[1], reverse=True)


def _load_csv(filepath):
    with filepath.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def _search_csv(filepath, search_cols, query, max_results):
    if not filepath.exists():
        return []

    rows = _load_csv(filepath)
    documents = [" ".join(str(row.get(column, "")) for column in search_cols) for row in rows]

    ranker = BM25()
    ranker.fit(documents)

    results = []
    for index, score in ranker.score(query)[:max_results]:
        if score <= 0:
            continue
        results.append({key: value for key, value in rows[index].items() if key and value})

    return results


def detect_domain(query):
    query_lower = query.lower()
    scores = {
        domain: sum(1 for keyword in keywords if re.search(r"\b" + re.escape(keyword) + r"\b", query_lower))
        for domain, keywords in DOMAIN_KEYWORDS.items()
    }
    best_domain = max(scores, key=scores.get)
    return best_domain if scores[best_domain] else "style"


def available_domains():
    return sorted(CSV_CONFIG)


def available_stacks():
    return sorted(STACK_CONFIG)


def search(query, domain=None, max_results=MAX_RESULTS):
    chosen_domain = domain or detect_domain(query)
    if chosen_domain not in CSV_CONFIG:
        return {
            "domain": chosen_domain,
            "query": query,
            "count": 0,
            "results": [],
            "error": f"Unknown domain: {chosen_domain}",
        }

    config = CSV_CONFIG[chosen_domain]
    results = _search_csv(DATA_DIR / config["file"], config["search_cols"], query, max_results)
    return {
        "domain": chosen_domain,
        "query": query,
        "file": config["file"],
        "count": len(results),
        "results": results,
    }


def search_stack(query, stack, max_results=MAX_RESULTS):
    if stack not in STACK_CONFIG:
        return {
            "domain": "stack",
            "stack": stack,
            "query": query,
            "count": 0,
            "results": [],
            "error": f"Unknown stack: {stack}",
        }

    results = _search_csv(DATA_DIR / STACK_CONFIG[stack], STACK_SEARCH_COLS, query, max_results)
    return {
        "domain": "stack",
        "stack": stack,
        "query": query,
        "file": STACK_CONFIG[stack],
        "count": len(results),
        "results": results,
    }
