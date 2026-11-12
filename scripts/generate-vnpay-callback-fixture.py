"""Independent offline Python oracle. Synthetic data only; never run in tests."""
import hashlib
import hmac
import json
from pathlib import Path
from urllib.parse import quote

path = Path(__file__).resolve().parents[1] / "test/fixtures/vnpay-callback.json"
data = json.loads(path.read_text(encoding="utf-8"))
def encode(value):
    return quote(value, safe="~!*'()", encoding="utf-8").replace("%20", "+")
for vector in (data, data["encoding"]):
    canonical = "&".join(encode(key) + "=" + encode(vector["fields"][key]) for key in sorted(vector["fields"]))
    vector["canonical"] = canonical
    vector["signature"] = hmac.new(data["key"].encode(), canonical.encode(), hashlib.sha512).hexdigest()
    vector["query"] = canonical + "&vnp_SecureHash=" + vector["signature"]
path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
