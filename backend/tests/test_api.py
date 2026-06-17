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


def test_disk_algorithms_list():
    r = client.get("/api/disk/algorithms")
    assert r.status_code == 200
    algos = r.json()["algorithms"]
    assert "FCFS" in algos
    assert "SSTF" in algos
    assert "SCAN" in algos
    assert "F-SCAN" in algos
    assert "N-SCAN" in algos


def test_disk_simulate_basic():
    r = client.post("/api/disk/simulate", json={
        "algorithm": "SCAN",
        "io_requests": [
            {"进程名": "P1", "柱面号": 98, "磁道号": 2, "物理记录号": 3},
            {"进程名": "P2", "柱面号": 183, "磁道号": 1, "物理记录号": 5},
            {"进程名": "P3", "柱面号": 37, "磁道号": 3, "物理记录号": 2},
        ],
        "head": 53,
        "current_record": 0,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["module"] == "disk"
    assert data["algorithm"] == "SCAN"
    assert len(data["steps"]) == 3
    assert data["metrics"]["总寻道道数"] > 0


def test_disk_simulate_with_geometry():
    r = client.post("/api/disk/simulate", json={
        "algorithm": "SSTF",
        "io_requests": [
            {"进程名": "P1", "柱面号": 50, "磁道号": 0, "物理记录号": 3},
        ],
        "head": 10,
        "current_record": 0,
        "geometry": {
            "cylinders": 200,
            "tracks_per_cylinder": 4,
            "records_per_track": 8,
        },
    })
    assert r.status_code == 200
    assert r.json()["metrics"]["总寻道道数"] == 40


def test_disk_benchmark():
    r = client.post("/api/disk/benchmark", json={
        "io_requests": [
            {"进程名": "P1", "柱面号": 98, "磁道号": 2, "物理记录号": 3},
            {"进程名": "P2", "柱面号": 183, "磁道号": 1, "物理记录号": 5},
            {"进程名": "P3", "柱面号": 37, "磁道号": 3, "物理记录号": 2},
        ],
        "head": 53,
        "algorithms": ["FCFS", "SSTF", "SCAN", "LOOK"],
    })
    assert r.status_code == 200
    data = r.json()
    assert "FCFS" in data
    assert "SSTF" in data
    assert "SCAN" in data
    assert "LOOK" in data
    # SSTF 应该比 FCFS 更少寻道
    assert data["SSTF"]["总寻道道数"] <= data["FCFS"]["总寻道道数"]


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
