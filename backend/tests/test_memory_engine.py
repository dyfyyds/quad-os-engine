"""单元测试：运行时 MemoryEngine。

覆盖 9 个主要测试场景。
"""
from app.engines.memory_engine import MemoryEngine


def _make_page_table(pages: list[int]) -> list[dict]:
    return [
        {
            "页号": p,
            "标志": 0,
            "主存块号": None,
            "loadTime": -1,
            "lastUsed": -1,
            "访问位": 0,
            "修改位": 0
        }
        for p in pages
    ]


def test_hit_and_update():
    """测试场景 1 & 8：页面命中与写操作修改位更新。"""
    # 物理块大小 3，已经装入了页 0 和 1
    pt = _make_page_table([0, 1, 2])
    # 模拟 0 在块 0，1 在块 1
    pt[0]["标志"] = 1
    pt[0]["主存块号"] = 0
    pt[0]["loadTime"] = 1
    pt[0]["lastUsed"] = 1

    engine = MemoryEngine(
        frames=[0, 1, None],
        page_tables={1: pt},
    )

    # 访问 0（命中，写操作）
    hit, evicted, wrote_back, slot = engine.access_page(
        pid=1, page=0, is_write=True, current_time=5, algorithm="LRU"
    )
    assert hit is True
    assert evicted is None
    assert wrote_back is False
    assert slot == 0

    # 检查状态更新
    row = engine._get_page_row(1, 0)
    assert row["lastUsed"] == 5
    assert row["修改位"] == 1

    # 再次访问并检查 CLOCK 访问位
    engine2 = MemoryEngine(
        frames=[0, 1, None],
        page_tables={1: pt},
    )
    hit, _, _, _ = engine2.access_page(
        pid=1, page=0, is_write=False, current_time=6, algorithm="CLOCK"
    )
    assert hit is True
    assert engine2._get_page_row(1, 0)["访问位"] == 1


def test_fault_with_empty_frames():
    """测试场景 2：缺页装入空闲页框。"""
    pt = _make_page_table([0, 1, 2])
    engine = MemoryEngine(
        frames=[0, None, None],
        page_tables={1: pt},
    )
    pt[0]["标志"] = 1
    pt[0]["主存块号"] = 0

    # 访问 1（缺页，空闲块为 1）
    hit, evicted, wrote_back, slot = engine.access_page(
        pid=1, page=1, is_write=False, current_time=2, algorithm="FIFO"
    )
    assert hit is False
    assert evicted is None
    assert wrote_back is False
    assert slot == 1
    assert engine.frames == [0, 1, None]
    assert engine._get_page_row(1, 1)["主存块号"] == 1
    assert engine._get_page_row(1, 1)["标志"] == 1


def test_fifo_eviction():
    """测试场景 3：缺页 FIFO 淘汰，且验证脏页写回。"""
    pt = _make_page_table([0, 1, 2])
    pt[0]["标志"] = 1
    pt[0]["主存块号"] = 0
    pt[0]["loadTime"] = 1
    pt[0]["修改位"] = 1  # 脏页

    pt[1]["标志"] = 1
    pt[1]["主存块号"] = 1
    pt[1]["loadTime"] = 2

    engine = MemoryEngine(
        frames=[0, 1],
        page_tables={1: pt},
    )

    # 访问 2（物理页框满，应淘汰 0 因为其 loadTime 较小）
    hit, evicted, wrote_back, slot = engine.access_page(
        pid=1, page=2, is_write=False, current_time=3, algorithm="FIFO"
    )
    assert hit is False
    assert evicted == 0
    assert wrote_back is True  # 脏页触发写回
    assert slot == 0
    assert engine.frames == [2, 1]
    assert engine._get_page_row(1, 0)["标志"] == 0
    assert engine._get_page_row(1, 2)["标志"] == 1
    assert engine._get_page_row(1, 2)["主存块号"] == 0


def test_lru_eviction():
    """测试场景 4：缺页 LRU 淘汰。"""
    pt = _make_page_table([0, 1, 2])
    pt[0]["标志"] = 1
    pt[0]["主存块号"] = 0
    pt[0]["lastUsed"] = 10  # 最近才访问

    pt[1]["标志"] = 1
    pt[1]["主存块号"] = 1
    pt[1]["lastUsed"] = 2  # 很久以前访问

    engine = MemoryEngine(
        frames=[0, 1],
        page_tables={1: pt},
    )

    # 访问 2（物理页框满，淘汰 1）
    hit, evicted, wrote_back, slot = engine.access_page(
        pid=1, page=2, is_write=False, current_time=12, algorithm="LRU"
    )
    assert hit is False
    assert evicted == 1
    assert slot == 1
    assert engine.frames == [0, 2]


def test_opt_eviction_and_tie():
    """测试场景 5：缺页 OPT 淘汰及平局选择最小 slot。"""
    pt = _make_page_table([0, 1, 2, 3])
    # 模拟 frames 为 [0, 1, 2] 满状态
    for k in range(3):
        pt[k]["标志"] = 1
        pt[k]["主存块号"] = k

    # 模拟未来引用串，此时 pid=1 位于 ptr=0
    # 未来引用： 1 访问，0 访问，2 永不访问
    engine = MemoryEngine(
        frames=[0, 1, 2],
        page_tables={1: pt},
        process_refs={1: [1, 0]},
        process_ptrs={1: 0},
    )

    # 访问 3（缺页，应淘汰 2 选 slot 2，因为 2 未来不访问，距离无穷大）
    hit, evicted, wrote_back, slot = engine.access_page(
        pid=1, page=3, is_write=False, current_time=0, algorithm="OPT"
    )
    assert hit is False
    assert evicted == 2
    assert slot == 2

    # 测试平局情况：0 和 1 在未来都不再访问，淘汰 slot 较小的（即 0）
    engine_tie = MemoryEngine(
        frames=[0, 1, 2],
        page_tables={1: pt},
        process_refs={1: [2]}, # 只有 2 会在未来被访问，0 和 1 都不再访问
        process_ptrs={1: 0},
    )
    hit, evicted, wrote_back, slot = engine_tie.access_page(
        pid=1, page=3, is_write=False, current_time=0, algorithm="OPT"
    )
    assert hit is False
    assert evicted == 0  # 0 占用 slot 0， 1 占用 slot 1。平局选择 slot 0 的 0 淘汰
    assert slot == 0


def test_clock_eviction():
    """测试场景 6：缺页 CLOCK 淘汰与二次机会扫描。"""
    pt = _make_page_table([0, 1, 2])
    # slot 0 页号 0， 访问位 = 1
    pt[0]["标志"] = 1
    pt[0]["主存块号"] = 0
    pt[0]["访问位"] = 1

    # slot 1 页号 1， 访问位 = 0
    pt[1]["标志"] = 1
    pt[1]["主存块号"] = 1
    pt[1]["访问位"] = 0

    engine = MemoryEngine(
        frames=[0, 1],
        page_tables={1: pt},
        clock_ptr=0, # 指针指向 slot 0
    )

    # 访问 2。
    # 扫描 slot 0 (访问位=1): 清零为 0，指针前移指向 slot 1。
    # 扫描 slot 1 (访问位=0): 选中 slot 1，淘汰页 1。
    # 淘汰后指针指向 (slot 1 + 1) % 2 = slot 0。
    hit, evicted, wrote_back, slot = engine.access_page(
        pid=1, page=2, is_write=False, current_time=3, algorithm="CLOCK"
    )
    assert hit is False
    assert evicted == 1
    assert slot == 1
    assert engine.clock_ptr == 0
    assert engine._get_page_row(1, 0)["访问位"] == 0  # 确认降为 0
    assert engine._get_page_row(1, 2)["访问位"] == 1  # 装入新页访问位设为 1


def test_process_isolation():
    """测试场景 7：多进程页表隔离。"""
    pt_a = _make_page_table([0, 1])
    pt_b = _make_page_table([0, 1])

    # 进程 A (pid=1): 装入 0
    pt_a[0]["标志"] = 1
    pt_a[0]["主存块号"] = 0
    pt_a[0]["loadTime"] = 5

    # 进程 B (pid=2): 装入 1
    pt_b[1]["标志"] = 1
    pt_b[1]["主存块号"] = 1
    pt_b[1]["loadTime"] = 2

    engine = MemoryEngine(
        frames=[0, 1],
        page_tables={1: pt_a, 2: pt_b},
    )

    # 进程 A 访问 1 (进程 A 未命中该页，虽进程 B 在主存块 1 有加载，但由于隔离不共享)
    hit, evicted, wrote_back, slot = engine.access_page(
        pid=1, page=1, is_write=False, current_time=1, algorithm="FIFO"
    )
    assert hit is False
    assert slot == 1  # 物理块 1 发生替换，由 进程 A 的 1 顶替


def test_silberschatz_reference_string():
    """测试场景 9：Silberschatz 经典引用序列全流程统计对齐。"""
    # 引用串：7,0,1,2,0,3,0,4,2,3,0,3,2,1,2,0,1,7,0,1
    refs = [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2, 1, 2, 0, 1, 7, 0, 1]
    
    # 验证 LRU 缺页次数 = 12
    pt = _make_page_table(list(set(refs)))
    engine = MemoryEngine(
        frames=[None, None, None],
        page_tables={1: pt},
    )
    
    faults = 0
    for i, page in enumerate(refs):
        hit, _, _, _ = engine.access_page(
            pid=1, page=page, is_write=False, current_time=i, algorithm="LRU"
        )
        if not hit:
            faults += 1
            
    assert faults == 12
