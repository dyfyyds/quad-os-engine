"""页面置换引擎。

- run():       FIFO / LRU / OPT / CLOCK 四种置换算法（引用串 → 缺页统计 + 页框演化）。
- translate(): 实习一第一题 —— 分页地址转换与缺页中断（页表 + 指令序列）。
"""
from __future__ import annotations

from app.schemas.common import SimulationStep, SimulationTrace

ALGORITHMS = ["FIFO", "LRU", "OPT", "CLOCK"]


def run(algorithm, reference_string, frames):
    algo = algorithm.upper()
    if algo not in ALGORITHMS:
        raise ValueError(f"未知页面置换算法: {algorithm}")

    refs = list(reference_string)
    n = frames
    mem: list[int] = []
    insert_time: dict[int, int] = {}   # FIFO：装入时刻
    last_used: dict[int, int] = {}     # LRU：最近访问时刻
    use_bit: dict[int, int] = {}       # CLOCK：访问位
    hand = 0                            # CLOCK：指针

    steps: list[SimulationStep] = []
    faults = 0
    hits = 0

    for i, page in enumerate(refs):
        hit = page in mem
        evicted = None

        if hit:
            hits += 1
            last_used[page] = i
            if algo == "CLOCK":
                use_bit[page] = 1
        else:
            faults += 1
            if len(mem) < n:
                mem.append(page)
                if algo == "CLOCK":
                    use_bit[page] = 1
            else:
                if algo == "FIFO":
                    evicted = min(mem, key=lambda p: insert_time[p])
                    mem[mem.index(evicted)] = page
                elif algo == "LRU":
                    evicted = min(mem, key=lambda p: last_used.get(p, -1))
                    mem[mem.index(evicted)] = page
                elif algo == "OPT":
                    evicted = max(mem, key=lambda p: _next_use(refs, i + 1, p))
                    mem[mem.index(evicted)] = page
                elif algo == "CLOCK":
                    while use_bit[mem[hand]] == 1:
                        use_bit[mem[hand]] = 0
                        hand = (hand + 1) % n
                    evicted = mem[hand]
                    mem[hand] = page
                    use_bit[page] = 1
                    hand = (hand + 1) % n
                if evicted is not None:
                    use_bit.pop(evicted, None)
            insert_time[page] = i
            last_used[page] = i

        snapshot = (mem + [None] * n)[:n]
        if hit:
            desc = f"访问页 {page}：命中"
        elif evicted is None:
            desc = f"访问页 {page}：缺页，装入空闲块"
        else:
            desc = f"访问页 {page}：缺页，换出页 {evicted}"

        steps.append(
            SimulationStep(
                index=i,
                description=desc,
                state={
                    "引用页": page,
                    "命中": hit,
                    "缺页": not hit,
                    "换出页": evicted,
                    "页框": snapshot,
                    "累计缺页": faults,
                },
                highlight={"命中": hit, "换出页": evicted},
            )
        )

    total = len(refs)
    metrics = {
        "访问总数": total,
        "缺页次数": faults,
        "命中次数": hits,
        "缺页率": round(faults / total, 2) if total else 0,
        "命中率": round(hits / total, 2) if total else 0,
    }
    final_state = {"最终页框": (mem + [None] * n)[:n], "缺页次数": faults}
    return SimulationTrace(
        module="paging",
        algorithm=algo,
        input_echo={"reference_string": refs, "frames": n},
        steps=steps,
        metrics=metrics,
        final_state=final_state,
    )


def _next_use(refs, start, page):
    """OPT：page 在 refs[start:] 中下一次出现的距离，未出现记为无穷大。"""
    future = refs[start:]
    return future.index(page) if page in future else float("inf")


def translate(page_table, instructions, block_size=128):
    """分页地址转换与缺页中断（实习一第一题）。"""
    pt = {row["页号"]: row for row in page_table}
    results = []
    steps: list[SimulationStep] = []
    faults = 0

    for i, ins in enumerate(instructions):
        page = ins["页号"]
        unit = ins["单元号"]
        op = ins.get("操作", "")
        row = pt.get(page)
        if row and row.get("标志") == 1:
            block = row["主存块号"]
            addr = block * block_size + unit
            fault = False
            desc = f"[{op}] 页{page} 单元{unit}：在主存块{block} → 绝对地址 {block}×{block_size}+{unit} = {addr}"
        else:
            block = None
            addr = None
            fault = True
            faults += 1
            desc = f"[{op}] 页{page} 单元{unit}：标志=0，产生缺页中断 *{page}"

        results.append({"页号": page, "单元号": unit, "主存块号": block, "绝对地址": addr, "缺页": fault})
        steps.append(
            SimulationStep(
                index=i,
                description=desc,
                state={"页号": page, "单元号": unit, "绝对地址": addr, "缺页": fault},
                highlight={"缺页": fault},
            )
        )

    metrics = {"指令总数": len(instructions), "缺页次数": faults}
    final_state = {"转换结果": results, "页表": page_table, "块长": block_size}
    return SimulationTrace(
        module="paging",
        algorithm="地址转换",
        input_echo={"block_size": block_size, "instructions": instructions},
        steps=steps,
        metrics=metrics,
        final_state=final_state,
    )
