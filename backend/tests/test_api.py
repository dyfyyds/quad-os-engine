"""API 层冒烟测试（FastAPI TestClient）。"""
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_disk_run_scan():
    r = client.post("/api/disk/run", json={
        "algorithm": "SCAN",
        "requests": [98, 183, 37, 122, 14, 124, 65, 67],
        "head": 53, "disk_size": 200, "direction": "up",
    })
    assert r.status_code == 200
    assert r.json()["metrics"]["总寻道道数"] == 331


def test_scheduling_run_fcfs():
    r = client.post("/api/scheduling/run", json={
        "algorithm": "FCFS",
        "jobs": [
            {"name": "A", "arrival": 0, "burst": 4},
            {"name": "B", "arrival": 1, "burst": 3},
        ],
    })
    assert r.status_code == 200
    assert r.json()["final_state"]["完成顺序"] == ["A", "B"]


def test_paging_run_fifo():
    r = client.post("/api/paging/run", json={
        "algorithm": "FIFO",
        "reference_string": [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2, 1, 2, 0, 1, 7, 0, 1],
        "frames": 3,
    })
    assert r.status_code == 200
    assert r.json()["metrics"]["缺页次数"] == 15


def test_banker_safety():
    r = client.post("/api/banker/safety", json={
        "available": [3, 3, 2],
        "max": [[7, 5, 3], [3, 2, 2], [9, 0, 2], [2, 2, 2], [4, 3, 3]],
        "allocation": [[0, 1, 0], [2, 0, 0], [3, 0, 2], [2, 1, 1], [0, 0, 2]],
    })
    assert r.status_code == 200
    assert r.json()["metrics"]["安全"] is True


def test_sync_run():
    r = client.post("/api/sync/run", json={
        "buffer_size": 2,
        "operations": [{"type": "produce"}, {"type": "produce"},
                       {"type": "produce"}, {"type": "consume"}],
    })
    assert r.status_code == 200
    assert r.json()["metrics"]["生产次数"] == 3


def test_invalid_algorithm_returns_400():
    r = client.post("/api/disk/run", json={
        "algorithm": "BOGUS", "requests": [1, 2], "head": 0,
    })
    assert r.status_code == 400


def test_presets_disk():
    r = client.get("/api/presets/disk")
    assert r.status_code == 200
    assert len(r.json()["presets"]) >= 1
