import csv
import importlib
import re
import sys
import unittest
from pathlib import Path


sys.dont_write_bytecode = True
TOOL_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = TOOL_ROOT / "scripts"
DATA_DIR = TOOL_ROOT / "data"
RTL_LEVELS = {"full", "partial", "caveats"}
LEGACY_WORDS = re.compile(r"\b(?:legacy|deprecated)\b", re.IGNORECASE)


def read_rows(relative_path):
    with (DATA_DIR / relative_path).open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


class StatusFilterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(SCRIPTS_DIR))
        cls.core = importlib.import_module("core")
        cls.design_system = importlib.import_module("design_system")
        cls.styles = read_rows("styles.csv")
        cls.style_status = {row["Style Category"]: row["Status"] for row in cls.styles}

    def test_inactive_styles_never_rank(self):
        inactive = [row for row in self.styles if row["Status"] != "active"]
        self.assertTrue(any(row["Status"] == "deprecated" for row in inactive))
        self.assertTrue(any(row["Status"] == "supplemental" for row in inactive))
        for row in inactive:
            query = f"{row['Style Category']} {row['Keywords']}"
            results = self.core.search(query, domain="style", max_results=3)["results"]
            self.assertTrue(results, query)
            for result in results:
                self.assertEqual("active", result["Status"], f"{query!r} ranked {result['Style Category']!r}")

    def test_generated_design_system_picks_an_active_style(self):
        for brief in ["healthcare patient portal", "developer tools documentation", "fintech banking app"]:
            result = self.design_system.generate_design_system(brief, "Status Test")
            self.assertEqual("active", self.style_status.get(result["style"]["name"]), brief)
            self.assertIn(result["style"].get("rtl_level"), RTL_LEVELS, brief)

    def test_stack_search_skips_deprecated_rows_unless_asked(self):
        deprecated = [row for row in read_rows("stacks/svelte.csv") if row["Status"] == "deprecated"]
        self.assertTrue(deprecated)
        row = deprecated[0]
        query = LEGACY_WORDS.sub(" ", f"{row['Guideline']} {row['Description']}")
        current = self.core.search_stack(query, "svelte", max_results=5)["results"]
        self.assertTrue(current)
        self.assertTrue(all(result["Status"] == "active" for result in current))
        legacy = self.core.search_stack(f"legacy {query}", "svelte", max_results=5)["results"]
        self.assertIn(row["Guideline"], [result["Guideline"] for result in legacy])


if __name__ == "__main__":
    unittest.main()
