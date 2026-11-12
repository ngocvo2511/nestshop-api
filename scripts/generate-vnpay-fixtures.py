"""Offline independent oracle; run explicitly, never as part of a test.
Only synthetic fixture data. No application imports, secrets or network requests.
Canonicalization reproduces encodeURIComponent safe characters and space->plus
using Python urllib rather than the TypeScript implementation.
"""
import hashlib
import hmac
import json
from pathlib import Path
from urllib.parse import quote

path = Path(__file__).resolve().parents[1] / "test/fixtures/vnpay-signing.json"
data = json.loads(path.read_text(encoding="utf-8"))
for name in ("full", "encoding"):
    fields = data[name]["fields"]
    def encode(value):
        return quote(value, safe="~!*'()", encoding="utf-8").replace("%20", "+")
    canonical = "&".join(encode(key) + "=" + encode(fields[key]) for key in sorted(fields))
    data[name]["canonical"] = canonical
    data[name]["signature"] = hmac.new(data["key"].encode(), canonical.encode(), hashlib.sha512).hexdigest()
path.write_text(json.dumps(data, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
