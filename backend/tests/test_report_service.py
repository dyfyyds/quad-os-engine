"""实验报告导出（Markdown）测试。"""
from app.engines import disk_engine, scheduling_engine
from app.services import report_service


def test_markdown_has_key_sections():
    t = disk_engine.run("SCAN", [98, 183, 37, 122, 14, 124, 65, 67], 53, 200, "up")
    md = report_service.to_markdown(t)
    assert md.startswith("# 实验报告")
    assert "磁盘调度" in md
    assert "SCAN" in md
    assert "总寻道道数" in md
    assert "331" in md
    assert "## 调度指标" in md
    assert "## 分步过程" in md


def test_markdown_scheduling_metrics_rendered():
    t = scheduling_engine.run("FCFS", [
        {"name": "A", "arrival": 0, "burst": 4},
        {"name": "B", "arrival": 1, "burst": 3},
    ])
    md = report_service.to_markdown(t)
    assert "平均周转时间" in md
    assert "作业调度" in md
