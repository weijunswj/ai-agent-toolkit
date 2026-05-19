import importlib
import sys
import unittest
from pathlib import Path


sys.dont_write_bytecode = True
TOOL_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = TOOL_ROOT.parents[3]
SCRIPTS_DIR = TOOL_ROOT / "scripts"
FORBIDDEN_STRINGS = [
    "requests",
    "urllib",
    "httpx",
    "aiohttp",
    "socket",
    "subprocess",
    "os.system",
    "webbrowser",
    "curl",
    "wget",
    "npm install",
    "pip install",
]
EXECUTABLE_EXTENSIONS = {".ps1", ".cmd", ".bat", ".cjs", ".mjs", ".js", ".ts", ".tsx", ".py", ".sh", ".exe", ".dll"}


class DesignGeneratorLocalOnlyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(SCRIPTS_DIR))
        cls.core = importlib.import_module("core")
        cls.design_system = importlib.import_module("design_system")

    def test_search_reads_local_csv_data(self):
        result = self.core.search("saas dashboard", domain="product", max_results=1)
        self.assertEqual(result["domain"], "product")
        self.assertGreaterEqual(result["count"], 1)
        self.assertIn("results", result)

    def test_design_system_generates_from_local_data(self):
        result = self.design_system.generate_design_system("saas dashboard", "Toolkit Test")
        self.assertEqual(result["project_name"], "Toolkit Test")
        for key in ["project_name", "category", "pattern", "style", "colors", "typography"]:
            self.assertIn(key, result)

    def test_stack_search_reads_local_stack_data(self):
        result = self.core.search_stack("server components", "nextjs", max_results=1)
        self.assertEqual(result["domain"], "stack")
        self.assertEqual(result["stack"], "nextjs")
        self.assertGreaterEqual(result["count"], 1)

    def test_forbidden_imports_and_strings_are_absent_from_scripts(self):
        script_text = "\n".join(path.read_text(encoding="utf-8") for path in SCRIPTS_DIR.glob("*.py"))
        lowered = script_text.lower()
        for token in FORBIDDEN_STRINGS:
            self.assertNotIn(token, lowered)

    def test_design_executable_tooling_stays_inside_declared_generator(self):
        skill_files = [
            path
            for path in (REPO_ROOT / "skills").rglob("*")
            if path.is_file() and path.suffix.lower() in EXECUTABLE_EXTENSIONS
        ]
        design_tool_files = [path for path in skill_files if "design" in path.parts]
        unexpected = [
            path
            for path in design_tool_files
            if TOOL_ROOT not in path.parents
        ]
        self.assertEqual(unexpected, [])


if __name__ == "__main__":
    unittest.main()
