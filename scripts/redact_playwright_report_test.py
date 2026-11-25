"""Tests for scripts/redact-playwright-report.py (stdlib unittest, no dependencies).

Run: python3 -m unittest discover -s scripts -p '*_test.py'
"""

from __future__ import annotations

import base64
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "redact-playwright-report.py")

BYPASS = "byp4ss-S3cret/with+chars=="
AUTH = "auth-signing-secret-0123456789"
JWT = "eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIn0..aBcDeFgHiJkLmNoP.QrStUvWxYz0123456789_-.TaGtAg"
VERCEL_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJieXBhc3MiOnRydWV9.c2lnbmF0dXJl"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00\x01binary eyJhbGciOiJIUzI1NiJ9.eyJ4IjoxfQ.c2ln \xff\xfe"


def make_zip(entries: list[tuple[str, bytes]]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in entries:
            z.writestr(name, data)
    return buf.getvalue()


def read_zip(data: bytes) -> list[tuple[str, bytes]]:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return [(i.filename, z.read(i)) for i in z.infolist()]


def trace_zip() -> bytes:
    trace = "\n".join([
        json.dumps({"type": "context-options", "options": {"extraHTTPHeaders": [
            {"name": "x-vercel-protection-bypass", "value": BYPASS},
            {"name": "x-vercel-set-bypass-cookie", "value": "true"},
        ]}}),
        json.dumps({"type": "log", "message": f"  - x-vercel-protection-bypass: {BYPASS}"}),
        json.dumps({"type": "log", "message": "navigating to https://p.vercel.app/?x-vercel-protection-bypass="
                    + "unknownValue123&x=1"}),
    ])
    network = json.dumps({"snapshot": {"request": {"headers": [
        {"name": "Cookie", "value": f"__Secure-authjs.session-token={JWT}; other=1"},
        {"name": "x-vercel-protection-bypass", "value": "an-unknown-bypass-value"},
    ]}, "response": {"headers": [
        {"name": "Set-Cookie", "value": f"_vercel_jwt={VERCEL_JWT}; Path=/; HttpOnly"},
        {"name": "Set-Cookie", "value": "__Secure-authjs.session-token.1=notAJwtChunkValue; Path=/"},
    ]}}})
    # A nested zip inside the trace zip, with a base64 copy of the secret.
    nested = make_zip([("inner.json", json.dumps({"auth": base64.b64encode(AUTH.encode()).decode()}).encode())])
    return make_zip([
        ("0-trace.trace", trace.encode()),
        ("0-trace.network", network.encode()),
        ("resources/abc.png", PNG),
        ("resources/nested.bin", nested),
        ("0-trace.stacks", b"{}"),
    ])


class RedactTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = os.path.join(self.tmp.name, "playwright-report")
        os.makedirs(os.path.join(self.root, "data"))
        with open(os.path.join(self.root, "data", "deadbeef.zip"), "wb") as f:
            f.write(trace_zip())
        with open(os.path.join(self.root, "data", "shot.png"), "wb") as f:
            f.write(PNG)
        report = make_zip([
            ("report.json", json.dumps({"files": [], "note": f"Cookie: _vercel_jwt={VERCEL_JWT}"}).encode()),
            ("abc.json", json.dumps({"headers": {"x-vercel-protection-bypass": BYPASS}}).encode()),
        ])
        html = ("<!DOCTYPE html><html><body><script>window.playwrightReportBase64 = "
                f"\"data:application/zip;base64,{base64.b64encode(report).decode()}\";</script>"
                f"<img src=\"data:image/png;base64,{base64.b64encode(PNG).decode()}\"></body></html>")
        with open(os.path.join(self.root, "index.html"), "w") as f:
            f.write(html)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def run_script(self) -> subprocess.CompletedProcess[str]:
        env = {
            "PATH": os.environ.get("PATH", ""),
            "REDACT_ENV": "VERCEL_AUTOMATION_BYPASS_SECRET, E2E_AUTH_SECRET,UNSET_ONE",
            "VERCEL_AUTOMATION_BYPASS_SECRET": BYPASS,
            "E2E_AUTH_SECRET": AUTH,
        }
        return subprocess.run([sys.executable, "-I", SCRIPT, self.root], env=env,
                              capture_output=True, text=True)

    def assert_no_secret_output(self, proc: subprocess.CompletedProcess[str]) -> None:
        for value in (BYPASS, AUTH, JWT, VERCEL_JWT):
            self.assertNotIn(value, proc.stdout + proc.stderr)

    def test_redacts_everything_and_keeps_structure(self) -> None:
        before = read_zip(trace_zip())
        proc = self.run_script()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assert_no_secret_output(proc)
        self.assertIn("redact-playwright-report: scanned 3 files", proc.stdout)

        with open(os.path.join(self.root, "data", "deadbeef.zip"), "rb") as f:
            after = read_zip(f.read())
        self.assertEqual([n for n, _ in after], [n for n, _ in before])
        entries = dict(after)
        trace = entries["0-trace.trace"].decode()
        network = entries["0-trace.network"].decode()
        for text in (trace, network):
            for value in (BYPASS, JWT, VERCEL_JWT, "unknownValue123", "an-unknown-bypass-value",
                          "notAJwtChunkValue"):
                self.assertNotIn(value, text)
        self.assertIn('"value": "[REDACTED:VERCEL_AUTOMATION_BYPASS_SECRET]"', trace)
        self.assertIn("x-vercel-protection-bypass: [REDACTED:VERCEL_AUTOMATION_BYPASS_SECRET]", trace)
        self.assertIn("x-vercel-protection-bypass=[REDACTED:header]&x=1", trace)
        self.assertIn('"x-vercel-set-bypass-cookie", "value": "true"', trace)
        self.assertIn("__Secure-authjs.session-token=[REDACTED:jwt]; other=1", network)
        self.assertIn("_vercel_jwt=[REDACTED:jwt]; Path=/", network)
        self.assertIn("__Secure-authjs.session-token.1=[REDACTED:cookie]", network)
        self.assertIn('"value": "[REDACTED:header]"', network)
        # Binary resource inside the zip is untouched; nested zip still opens and is clean.
        self.assertEqual(entries["resources/abc.png"], PNG)
        inner = dict(read_zip(entries["resources/nested.bin"]))
        self.assertEqual(json.loads(inner["inner.json"]), {"auth": "[REDACTED:E2E_AUTH_SECRET]"})

        with open(os.path.join(self.root, "data", "shot.png"), "rb") as f:
            self.assertEqual(f.read(), PNG)

        with open(os.path.join(self.root, "index.html")) as f:
            html = f.read()
        prefix = "data:application/zip;base64,"
        start = html.index(prefix) + len(prefix)
        blob = html[start:html.index('"', start)]
        report = dict(read_zip(base64.b64decode(blob)))
        self.assertEqual(sorted(report), ["abc.json", "report.json"])
        self.assertIn("_vercel_jwt=[REDACTED:jwt]", report["report.json"].decode())
        self.assertEqual(json.loads(report["abc.json"]),
                         {"headers": {"x-vercel-protection-bypass": "[REDACTED:VERCEL_AUTOMATION_BYPASS_SECRET]"}})
        # The embedded PNG data URI is left alone.
        self.assertIn(f"data:image/png;base64,{base64.b64encode(PNG).decode()}", html)

    def test_idempotent(self) -> None:
        self.assertEqual(self.run_script().returncode, 0)
        snapshot = {}
        for d, _, files in os.walk(self.root):
            for name in files:
                with open(os.path.join(d, name), "rb") as f:
                    snapshot[os.path.join(d, name)] = f.read()
        proc = self.run_script()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("secret=0, jwt=0, cookie=0, header=0", proc.stdout)
        for path, data in snapshot.items():
            with open(path, "rb") as f:
                self.assertEqual(f.read(), data, path)

    def test_fails_on_file_it_cannot_clean(self) -> None:
        # A non-zip binary file is never rewritten, so a secret in it must fail the run.
        with open(os.path.join(self.root, "data", "video.webm"), "wb") as f:
            f.write(b"\x1a\x45\xdf\xa3\x00" + BYPASS.encode() + b"\xff")
        proc = self.run_script()
        self.assertEqual(proc.returncode, 1)
        self.assertIn("video.webm: still contains VERCEL_AUTOMATION_BYPASS_SECRET", proc.stderr)
        self.assert_no_secret_output(proc)

    def test_fails_on_unreadable_zip(self) -> None:
        with open(os.path.join(self.root, "data", "broken.zip"), "wb") as f:
            f.write(b"PK\x03\x04garbage\xff\xfe" + AUTH.encode())
        proc = self.run_script()
        self.assertEqual(proc.returncode, 1)
        self.assertIn("broken.zip: still contains E2E_AUTH_SECRET", proc.stderr)
        self.assert_no_secret_output(proc)

    def test_missing_dir_is_usage_error(self) -> None:
        proc = subprocess.run([sys.executable, "-I", SCRIPT, os.path.join(self.tmp.name, "nope")],
                              capture_output=True, text=True)
        self.assertEqual(proc.returncode, 2)


if __name__ == "__main__":
    unittest.main()
