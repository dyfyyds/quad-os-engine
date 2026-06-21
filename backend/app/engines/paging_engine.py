"""页面置换引擎。

- run():       FIFO / LRU / OPT / CLOCK 四种置换算法（引用串 → 缺页统计 + 页框演化）。
- translate(): 实习一第一题 —— 分页地址转换与缺页中断（页表 + 指令序列）。
"""
from __future__ import annotations

from app.schemas.common import SimulationStep, SimulationTrace

ALGORITHMS = ["FIFO", "LRU", "OPT", "CLOCK"]


def find_frame_owner(processes, slot):
    for p in processes:
        for page_num, row in p["page_table"].items():
            if row["标志"] == 1 and row["主存块号"] == slot:
                return p, row
    return None, None


def run(algorithm, reference_string, frames):
    algo = algorithm.upper()
    if algo not in ALGORITHMS:
        raise ValueError(f"未知页面置换算法: {algorithm}")

    refs = list(reference_string)
    n = frames
    
    unique_pages = set(refs)
    process = {
        "name": "Process-0",
        "page_table": {
            page: {
                "页号": page,
                "标志": 0,
                "主存块号": None,
                "loadTime": -1,
                "lastUsed": -1,
                "访问位": 0,
                "修改位": 0,
            }
            for page in unique_pages
        }
    }
    processes = [process]
    
    frames_list = [None] * n
    clock_ptr = 0
    steps: list[SimulationStep] = []
    faults = 0
    hits = 0
    write_backs = 0

    for i, page in enumerate(refs):
        row = process["page_table"][page]
        hit = row["标志"] == 1
        evicted = None
        wrote_back = False
        
        # Deterministic write access indicator: ~40% probability (matches frontend)
        is_write = ((page + i) % 5) < 2

        if hit:
            hits += 1
            row["lastUsed"] = i
            if algo == "CLOCK":
                row["访问位"] = 1
            if is_write:
                row["修改位"] = 1
        else:
            faults += 1
            # Check if there is an empty slot in frames_list
            empty_slot = -1
            for k in range(n):
                if frames_list[k] is None:
                    empty_slot = k
                    break
            
            if empty_slot >= 0:
                row["标志"] = 1
                row["主存块号"] = empty_slot
                row["loadTime"] = i
                row["lastUsed"] = i
                row["访问位"] = 1
                row["修改位"] = 1 if is_write else 0
                frames_list[empty_slot] = page
            else:
                # Need eviction
                if algo == "FIFO":
                    min_load = float("inf")
                    chosen_slot = 0
                    for k in range(n):
                        p_owner, owner_row = find_frame_owner(processes, k)
                        load_val = owner_row["loadTime"] if owner_row else -1
                        if load_val < min_load:
                            min_load = load_val
                            chosen_slot = k
                    slot = chosen_slot
                elif algo == "LRU":
                    min_used = float("inf")
                    chosen_slot = 0
                    for k in range(n):
                        p_owner, owner_row = find_frame_owner(processes, k)
                        used_val = owner_row["lastUsed"] if owner_row else -1
                        if used_val < min_used:
                            min_used = used_val
                            chosen_slot = k
                    slot = chosen_slot
                elif algo == "OPT":
                    max_next = -1
                    chosen_slot = 0
                    for k in range(n):
                        p_owner, owner_row = find_frame_owner(processes, k)
                        if not owner_row:
                            chosen_slot = k
                            break
                        next_use = float("inf")
                        for idx in range(i + 1, len(refs)):
                            if refs[idx] == owner_row["页号"]:
                                next_use = idx - (i + 1)
                                break
                        if next_use > max_next:
                            max_next = next_use
                            chosen_slot = k
                    slot = chosen_slot
                elif algo == "CLOCK":
                    found = False
                    loops = 0
                    while not found and loops < 100:
                        p_owner, owner_row = find_frame_owner(processes, clock_ptr)
                        if not owner_row or owner_row["访问位"] == 0:
                            slot = clock_ptr
                            found = True
                        else:
                            owner_row["访问位"] = 0
                            clock_ptr = (clock_ptr + 1) % n
                        loops += 1
                    clock_ptr = (clock_ptr + 1) % n

                # Perform eviction on slot
                p_owner, owner_row = find_frame_owner(processes, slot)
                if owner_row:
                    evicted = owner_row["页号"]
                    if owner_row["修改位"] == 1:
                        wrote_back = True
                        write_backs += 1
                    owner_row["标志"] = 0
                    owner_row["主存块号"] = None
                    owner_row["访问位"] = 0
                    owner_row["修改位"] = 0

                # Load new page
                row["标志"] = 1
                row["主存块号"] = slot
                row["loadTime"] = i
                row["lastUsed"] = i
                row["访问位"] = 1
                row["修改位"] = 1 if is_write else 0
                frames_list[slot] = page

        snapshot = list(frames_list)
        if hit:
            desc = f"访问页 {page}：命中"
        elif evicted is None:
            desc = f"访问页 {page}：缺页，装入空闲块"
        else:
            desc = f"访问页 {page}：缺页，换出页 {evicted}"
            if wrote_back:
                desc += "（已修改，写回外存）"

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
                    "写回": wrote_back,
                },
                highlight={"命中": hit, "换出页": evicted},
            )
        )

    total = len(refs)
    metrics = {
        "访问总数": total,
        "缺页次数": faults,
        "命中次数": hits,
        "写回次数": write_backs,
        "缺页率": round(faults / total, 2) if total else 0,
        "命中率": round(hits / total, 2) if total else 0,
    }
    final_state = {"最终页框": list(frames_list), "缺页次数": faults}
    return SimulationTrace(
        module="paging",
        algorithm=algo,
        input_echo={"reference_string": refs, "frames": n},
        steps=steps,
        metrics=metrics,
        final_state=final_state,
    )



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
