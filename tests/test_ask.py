import json
import os
import tempfile

os.environ["HUB_NO_SAMPLER"] = "1"
os.environ.setdefault("HUB_DB", os.path.join(tempfile.mkdtemp(), "hub.db"))

from hub import ask  # noqa: E402


def test_ask_labels_its_chat(monkeypatch):
    seen = {}

    class Reply:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self, *a): return json.dumps({"message": {"content": "The printer is idle."}, "model": "m"}).encode()

    def fake(req, timeout, context):
        seen["body"] = json.loads(req.data)
        return Reply()
    monkeypatch.setattr(ask, "context", lambda: "Printer: idle.")
    monkeypatch.setattr(ask.urllib.request, "urlopen", fake)
    assert ask.ask("Is the printer busy?")["answer"] == "The printer is idle."
    assert seen["body"]["title"] == "House question"
