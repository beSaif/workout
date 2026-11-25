#!/usr/bin/env python3
"""Scrub secrets from a Playwright HTML report before it is uploaded as a CI artifact.

Usage:
    REDACT_ENV=VERCEL_AUTOMATION_BYPASS_SECRET,E2E_AUTH_SECRET \\
        python3 scripts/redact-playwright-report.py playwright-report

Why this is needed: the report keeps traces as zips under data/<sha>.zip, and index.html
embeds the report itself as a base64 zip. Traces record request headers (including
x-vercel-protection-bypass), context options and cookies, so a plain grep/sed over the
directory never sees them. This script walks every file, descends into zips (detected by
their magic bytes, including nested zips) and into data:application/zip;base64 blobs, and
replaces:

  * each secret named in REDACT_ENV (literal, URL-encoded, base64 and JSON-escaped forms)
    with [REDACTED:<NAME>];
  * JWT/JWE-looking tokens (Vercel's _vercel_jwt bypass cookie, Auth.js session cookies,
    whose values are not known in advance) with [REDACTED:jwt];
  * values of the session/bypass cookies by name, in case a token does not look like a JWT
    (e.g. the second chunk of a chunked Auth.js cookie), with [REDACTED:cookie];
  * any remaining x-vercel-protection-bypass header or query value with [REDACTED:header].

Binary files that are not zips (screenshots, videos) are left untouched. After rewriting,
the whole report is scanned again with the same traversal; if a known secret or an
un-redacted bypass header remains anywhere, the script exits 1, naming only the file and
the secret's env var name. It never prints a secret value.

Python 3 standard library only.
"""

from __future__ import annotations

import base64
import binascii
import io
import json
import os
import re
import sys
import urllib.parse
import zipfile
from collections import Counter
from dataclasses import dataclass, field

ZIP_MAGIC = b"PK\x03\x04"
# Screenshots and videos: skip without trying to decode them.
BINARY_MAGICS = (
    b"\x89PNG\r\n\x1a\n",
    b"\xff\xd8\xff",  # JPEG
    b"\x1a\x45\xdf\xa3",  # WebM / Matroska
    b"GIF8",
    b"RIFF",  # WebP
)

REDACTED_PREFIX = "[REDACTED"
BYPASS_HEADER = "x-vercel-protection-bypass"

JWT_RE = re.compile(r"eyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]*){1,4}")

# Cookies whose values grant access: Vercel's bypass cookie and Auth.js / NextAuth
# session cookies (optionally chunked as name.0, name.1, ...).
SENSITIVE_COOKIES = r"(?:_vercel_jwt|(?:__Secure-|__Host-)?(?:authjs|next-auth)\.session-token(?:\.\d+)?)"

# name=value inside Cookie / Set-Cookie headers.
COOKIE_PAIR_RE = re.compile(
    r"(?<![A-Za-z0-9_.-])(" + SENSITIVE_COOKIES + r"=)(?!\[REDACTED)([^;\s\"'\\,]+)"
)

# {"name": "<sensitive>", "value": "..."} in traces and context options; quotes may be
# JSON-escaped once (\") when the object sits inside another JSON string.
_Q = r'\\*"'


def _name_value_re(name: str) -> re.Pattern[str]:
    return re.compile(
        "(" + _Q + r"name" + _Q + r"\s*:\s*" + _Q + name + _Q + r"\s*,\s*"
        + _Q + r"value" + _Q + r"\s*:\s*" + _Q + r")(?!\[REDACTED)([^\"\\]*)",
        re.IGNORECASE,
    )


COOKIE_JSON_RE = _name_value_re(SENSITIVE_COOKIES)
HEADER_JSON_RE = _name_value_re(re.escape(BYPASS_HEADER))
# {"x-vercel-protection-bypass": "..."} (extraHTTPHeaders as an object).
HEADER_OBJ_RE = re.compile(
    "(" + _Q + re.escape(BYPASS_HEADER) + _Q + r"\s*:\s*" + _Q + r")(?!\[REDACTED)([^\"\\]*)",
    re.IGNORECASE,
)
# "x-vercel-protection-bypass: value" in call logs and raw headers.
HEADER_LINE_RE = re.compile(
    r"(" + re.escape(BYPASS_HEADER) + r"[ \t]*:[ \t]*)(?!\[REDACTED)([^\s\"'\\,;&<>]+)",
    re.IGNORECASE,
)
# ?x-vercel-protection-bypass=value or &x-vercel-protection-bypass=value
HEADER_QUERY_RE = re.compile(
    r"(" + re.escape(BYPASS_HEADER) + r"=)(?!\[REDACTED)([^&\s\"'#\\<>]+)",
    re.IGNORECASE,
)
HEADER_RES = (HEADER_JSON_RE, HEADER_OBJ_RE, HEADER_LINE_RE, HEADER_QUERY_RE)

DATA_URI_RE = re.compile(r"(data:application/zip;base64,)([A-Za-z0-9+/=]+)")


@dataclass
class Secret:
    name: str
    forms: list[str]  # literal first, then the distinct encoded forms, longest first


def load_secrets(env: os._Environ[str] | dict[str, str]) -> list[Secret]:
    names = [n.strip() for n in env.get("REDACT_ENV", "").split(",") if n.strip()]
    secrets = []
    for name in names:
        value = env.get(name, "")
        if not value:
            continue
        raw = value.encode("utf-8")
        candidates = [
            urllib.parse.quote(value, safe=""),
            urllib.parse.quote_plus(value, safe=""),
            base64.b64encode(raw).decode("ascii"),
            base64.b64encode(raw).decode("ascii").rstrip("="),
            base64.urlsafe_b64encode(raw).decode("ascii"),
            base64.urlsafe_b64encode(raw).decode("ascii").rstrip("="),
            json.dumps(value)[1:-1],
            json.dumps(value, ensure_ascii=False)[1:-1],
        ]
        encoded = sorted({c for c in candidates if c and c != value}, key=len, reverse=True)
        secrets.append(Secret(name, [value, *encoded]))
    # Longer secrets first, so one secret that contains another is replaced whole.
    secrets.sort(key=lambda s: len(s.forms[0]), reverse=True)
    return secrets


@dataclass
class Walker:
    secrets: list[Secret]
    scan_only: bool = False
    counts: Counter[str] = field(default_factory=Counter)
    findings: list[tuple[str, str]] = field(default_factory=list)
    files: int = 0
    entries: int = 0

    # -- traversal ---------------------------------------------------------------

    def bytes_(self, data: bytes, label: str) -> bytes:
        """Redact (or, in scan mode, inspect) one blob of bytes; returns the new bytes."""
        if data.startswith(ZIP_MAGIC):
            out = self.zip_(data, label)
            if out is not None:
                return out
            # Not a readable zip: fall through and treat it as an opaque blob.
        if data.startswith(BINARY_MAGICS):
            return self.binary(data, label)
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            return self.binary(data, label)
        new = self.text(text, label)
        return data if new == text else new.encode("utf-8")

    def zip_(self, data: bytes, label: str) -> bytes | None:
        try:
            src = zipfile.ZipFile(io.BytesIO(data))
            infos = src.infolist()
            contents = [src.read(i) for i in infos]
        except (zipfile.BadZipFile, zipfile.LargeZipFile, NotImplementedError, OSError, EOFError):
            print(f"warning: {label} looks like a zip but cannot be read; treating it as binary",
                  file=sys.stderr)
            return None
        changed = False
        new_contents = []
        for info, content in zip(infos, contents):
            self.entries += 1
            if info.is_dir():
                new_contents.append(content)
                continue
            new = self.bytes_(content, f"{label}!{info.filename}")
            changed |= new != content
            new_contents.append(new)
        if not changed or self.scan_only:
            return data
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as dst:
            dst.comment = src.comment
            for info, content in zip(infos, new_contents):
                out = zipfile.ZipInfo(info.filename, date_time=info.date_time)
                out.external_attr = info.external_attr
                out.compress_type = zipfile.ZIP_STORED if info.is_dir() else zipfile.ZIP_DEFLATED
                dst.writestr(out, content)
        return buf.getvalue()

    def binary(self, data: bytes, label: str) -> bytes:
        # Never rewritten; a known secret inside is reported by the final scan.
        if self.scan_only:
            for s in self.secrets:
                if any(f.encode("utf-8") in data for f in s.forms):
                    self.findings.append((label, s.name))
        return data

    def text(self, text: str, label: str) -> str:
        # Split out embedded zip blobs, so text rules never run over base64 and the
        # blobs themselves are redacted as zips.
        parts = []
        pos = 0
        for i, m in enumerate(DATA_URI_RE.finditer(text)):
            parts.append(self.plain(text[pos:m.start()], label))
            parts.append(m.group(1))
            parts.append(self.data_uri(m.group(2), f"{label}!data-uri[{i}]"))
            pos = m.end()
        parts.append(self.plain(text[pos:], label))
        return "".join(parts)

    def data_uri(self, b64: str, label: str) -> str:
        try:
            raw = base64.b64decode(b64, validate=True)
        except (binascii.Error, ValueError):
            return self.plain(b64, label)
        new = self.bytes_(raw, label)
        return b64 if new == raw else base64.b64encode(new).decode("ascii")

    # -- rules -------------------------------------------------------------------

    def plain(self, text: str, label: str) -> str:
        if self.scan_only:
            self.scan_plain(text, label)
            return text
        for s in self.secrets:
            for form in s.forms:
                n = text.count(form)
                if n:
                    text = text.replace(form, f"[REDACTED:{s.name}]")
                    self.counts["secret"] += n
        text = self.sub(JWT_RE, lambda m: "[REDACTED:jwt]", text, "jwt")
        for rx in (COOKIE_PAIR_RE, COOKIE_JSON_RE):
            text = self.sub(rx, lambda m: m.group(1) + "[REDACTED:cookie]", text, "cookie")
        for rx in HEADER_RES:
            text = self.sub(rx, _redact_header_value, text, "header")
        return text

    def sub(self, rx: re.Pattern[str], repl, text: str, kind: str) -> str:
        new, n = rx.subn(repl, text)
        self.counts[kind] += n
        return new

    def scan_plain(self, text: str, label: str) -> None:
        for s in self.secrets:
            if any(f in text for f in s.forms):
                self.findings.append((label, s.name))
        for rx in HEADER_RES:
            if any(m.group(2) for m in rx.finditer(text)):
                self.findings.append((label, BYPASS_HEADER + " header"))
                break
        if JWT_RE.search(text):
            self.findings.append((label, "jwt"))
        if any(m.group(2) for rx in (COOKIE_PAIR_RE, COOKIE_JSON_RE) for m in rx.finditer(text)):
            self.findings.append((label, "session cookie"))


def _redact_header_value(m: re.Match[str]) -> str:
    # An empty value (e.g. an empty JSON string) leaks nothing.
    return m.group(1) + ("[REDACTED:header]" if m.group(2) else "")


def walk_dir(root: str, walker: Walker) -> None:
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for fname in sorted(filenames):
            path = os.path.join(dirpath, fname)
            if os.path.islink(path) or not os.path.isfile(path):
                continue
            walker.files += 1
            with open(path, "rb") as f:
                data = f.read()
            new = walker.bytes_(data, path)
            if new != data and not walker.scan_only:
                with open(path, "wb") as f:
                    f.write(new)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: redact-playwright-report.py <playwright-report dir>", file=sys.stderr)
        return 2
    root = argv[1]
    if not os.path.isdir(root):
        print(f"error: {root} is not a directory", file=sys.stderr)
        return 2

    secrets = load_secrets(os.environ)
    names = [n.strip() for n in os.environ.get("REDACT_ENV", "").split(",") if n.strip()]
    missing = sorted(set(names) - {s.name for s in secrets})
    if missing:
        print(f"note: no value set for {', '.join(missing)}; skipping literal redaction of it",
              file=sys.stderr)

    redactor = Walker(secrets)
    walk_dir(root, redactor)

    scanner = Walker(secrets, scan_only=True)
    walk_dir(root, scanner)

    kinds = ("secret", "jwt", "cookie", "header")
    summary = ", ".join(f"{k}={redactor.counts[k]}" for k in kinds)
    print(f"redact-playwright-report: scanned {redactor.files} files "
          f"({redactor.entries} zip entries); replacements: {summary}")

    if scanner.findings:
        seen = set()
        for label, name in scanner.findings:
            if (label, name) not in seen:
                seen.add((label, name))
                print(f"error: {label}: still contains {name}", file=sys.stderr)
        print("error: report is not clean; do not upload it", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
