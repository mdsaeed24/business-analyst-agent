import unittest
from pathlib import Path
from streamlit.testing.v1 import AppTest


class ShowcaseTests(unittest.TestCase):
    def test_overview_displays_validated_values(self):
        app = AppTest.from_file(str(Path(__file__).resolve().parents[1] / "streamlit_app.py")).run(timeout=30)
        self.assertFalse(app.exception)
        self.assertEqual(app.metric[0].value, "$594,411.43")
        self.assertEqual(len(app.metric), 4)
        self.assertTrue(any("synthetic" in item.value.lower() for item in app.info))

    def test_navigation_and_investigation_filter(self):
        app = AppTest.from_file(str(Path(__file__).resolve().parents[1] / "streamlit_app.py")).run(timeout=30)
        for page, count in [("Sales", 4), ("Billing", 3), ("Operations", 3)]:
            app.sidebar.radio[0].set_value(page).run()
            self.assertFalse(app.exception)
            self.assertEqual(len(app.metric), count)
        app.sidebar.radio[0].set_value("Investigations").run()
        self.assertFalse(app.exception)
        self.assertEqual(len(app.subheader), 9)
        app.checkbox[0].check().run()
        self.assertFalse(app.exception)
        self.assertGreater(len(app.subheader), 1)
        self.assertLess(len(app.subheader), 9)
        app.sidebar.radio[0].set_value("About the project").run()
        self.assertFalse(app.exception)
        self.assertTrue(any("does not run" in item.value for item in app.warning))


if __name__ == "__main__":
    unittest.main()
