"""页面置换引擎已知答案校验。

经典引用串（Silberschatz）：7,0,1,2,0,3,0,4,2,3,0,3,2,1,2,0,1,7,0,1
3 个物理块时：FIFO=15、LRU=12、OPT=9 次缺页。
"""
from app.engines import paging_engine

REF = [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2, 1, 2, 0, 1, 7, 0, 1]
FRAMES = 3


def test_fifo_fault_count():
    t = paging_engine.run("FIFO", REF, FRAMES)
    assert t.metrics["缺页次数"] == 15


def test_lru_fault_count():
    t = paging_engine.run("LRU", REF, FRAMES)
    assert t.metrics["缺页次数"] == 12


def test_opt_fault_count():
    t = paging_engine.run("OPT", REF, FRAMES)
    assert t.metrics["缺页次数"] == 9


def test_clock_small_trace():
    # 手工推演：[1,2,3,1,4,2] 3 块，CLOCK 二次机会 → 4 次缺页
    t = paging_engine.run("CLOCK", [1, 2, 3, 1, 4, 2], 3)
    assert t.metrics["缺页次数"] == 4


def test_metrics_consistency():
    t = paging_engine.run("FIFO", REF, FRAMES)
    assert t.metrics["访问总数"] == len(REF)
    assert t.metrics["命中次数"] + t.metrics["缺页次数"] == len(REF)
    assert t.metrics["缺页率"] == round(15 / len(REF), 2)
    assert len(t.steps) == len(REF)
    assert t.module == "paging"


def test_address_translation_hit_and_fault():
    # 实习一：块长 128，页 0~3 在主存
    page_table = [
        {"页号": 0, "标志": 1, "主存块号": 5},
        {"页号": 1, "标志": 1, "主存块号": 8},
        {"页号": 2, "标志": 1, "主存块号": 9},
        {"页号": 3, "标志": 1, "主存块号": 1},
        {"页号": 4, "标志": 0, "主存块号": None},
        {"页号": 5, "标志": 0, "主存块号": None},
        {"页号": 6, "标志": 0, "主存块号": None},
    ]
    instructions = [
        {"操作": "+", "页号": 0, "单元号": 70},   # 5*128+70 = 710
        {"操作": "存", "页号": 3, "单元号": 21},  # 1*128+21 = 149
        {"操作": "取", "页号": 6, "单元号": 40},  # 缺页 *6
    ]
    t = paging_engine.translate(page_table, instructions, block_size=128)
    results = t.final_state["转换结果"]
    assert results[0]["绝对地址"] == 710
    assert results[1]["绝对地址"] == 149
    assert results[2]["缺页"] is True
    assert results[2]["绝对地址"] is None
    assert t.metrics["缺页次数"] == 1
