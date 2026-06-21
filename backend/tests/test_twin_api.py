import json
from pathlib import Path
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)
FIX = Path(__file__).parent / "fixtures"


def test_tick_advances_clock():
    init = json.loads((FIX / "twin_init.json").read_text(encoding="utf-8"))
    r = client.post("/api/twin/tick", json={"state": init})
    assert r.status_code == 200
    body = r.json()
    assert body["state"]["clock"] == init["clock"] + 1
    assert isinstance(body["events"], list)


def test_bad_state_returns_422_or_400():
    r = client.post("/api/twin/tick", json={"state": {"clock": 0}})  # 缺字段
    assert r.status_code in (400, 422)
