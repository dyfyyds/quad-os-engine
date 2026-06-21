"""无状态运行时存储管理与页面置换引擎。

支持：
- 独立的物理页框列表（frames）。
- 独立的进程页表管理（page_tables）。
- 分步访问：access_page(pid, page, is_write, current_time, algorithm)。
"""
from __future__ import annotations

class MemoryEngine:
    def __init__(
        self,
        frames: list[int | None],
        page_tables: dict[int, list[dict]],
        clock_ptr: int = 0,
        process_refs: dict[int, list[int]] | None = None,
        process_ptrs: dict[int, int] | None = None,
    ):
        self.frames = list(frames)
        self.page_tables = {int(pid): [dict(row) for row in rows] for pid, rows in page_tables.items()}
        self.clock_ptr = clock_ptr
        self.process_refs = {int(pid): list(refs) for pid, refs in (process_refs or {}).items()}
        self.process_ptrs = {int(pid): int(ptr) for pid, ptr in (process_ptrs or {}).items()}
        self.n = len(self.frames)

    def _get_page_row(self, pid: int, page: int) -> dict | None:
        if pid not in self.page_tables:
            return None
        for row in self.page_tables[pid]:
            if row["页号"] == page:
                return row
        return None

    def find_frame_owner(self, slot: int) -> tuple[int, dict] | tuple[None, None]:
        for pid, pt in self.page_tables.items():
            for row in pt:
                if row["标志"] == 1 and row["主存块号"] == slot:
                    return pid, row
        return None, None

    def access_page(
        self,
        pid: int,
        page: int,
        is_write: bool,
        current_time: int,
        algorithm: str,
    ) -> tuple[bool, int | None, bool, int]:
        """访问某个页面。
        
        返回: (hit, evicted_page, wrote_back, slot)
        """
        algo = algorithm.upper()
        row = self._get_page_row(pid, page)
        
        if not row:
            if pid not in self.page_tables:
                self.page_tables[pid] = []
            row = {
                "页号": page,
                "标志": 0,
                "主存块号": None,
                "loadTime": -1,
                "lastUsed": -1,
                "访问位": 0,
                "修改位": 0
            }
            self.page_tables[pid].append(row)

        hit = row["标志"] == 1

        if hit:
            row["lastUsed"] = current_time
            if algo == "CLOCK":
                row["访问位"] = 1
            if is_write:
                row["修改位"] = 1
            return True, None, False, row["主存块号"]

        # Miss: Check if there is an empty slot in frames
        empty_slot = -1
        for k in range(self.n):
            if self.frames[k] is None:
                empty_slot = k
                break

        if empty_slot >= 0:
            row["标志"] = 1
            row["主存块号"] = empty_slot
            row["loadTime"] = current_time
            row["lastUsed"] = current_time
            row["访问位"] = 1
            row["修改位"] = 1 if is_write else 0
            self.frames[empty_slot] = page
            return False, None, False, empty_slot

        # Miss & Frame full: Evict
        evicted_page = None
        wrote_back = False

        if algo == "FIFO":
            min_load = float("inf")
            chosen_slot = 0
            for k in range(self.n):
                owner_pid, owner_row = self.find_frame_owner(k)
                load_val = owner_row["loadTime"] if owner_row else -1
                if load_val < min_load:
                    min_load = load_val
                    chosen_slot = k
            slot = chosen_slot

        elif algo == "LRU":
            min_used = float("inf")
            chosen_slot = 0
            for k in range(self.n):
                owner_pid, owner_row = self.find_frame_owner(k)
                used_val = owner_row["lastUsed"] if owner_row else -1
                if used_val < min_used:
                    min_used = used_val
                    chosen_slot = k
            slot = chosen_slot

        elif algo == "OPT":
            max_next = -1
            chosen_slot = 0
            for k in range(self.n):
                owner_pid, owner_row = self.find_frame_owner(k)
                if not owner_row:
                    chosen_slot = k
                    break
                
                next_use = float("inf")
                refs = self.process_refs.get(owner_pid, [])
                start_ptr = self.process_ptrs.get(owner_pid, 0)
                
                for idx in range(start_ptr, len(refs)):
                    if refs[idx] == owner_row["页号"]:
                        next_use = idx - start_ptr
                        break
                        
                if next_use > max_next:
                    max_next = next_use
                    chosen_slot = k
            slot = chosen_slot

        elif algo == "CLOCK":
            found = False
            loops = 0
            while not found and loops < 100:
                owner_pid, owner_row = self.find_frame_owner(self.clock_ptr)
                if not owner_row or owner_row["访问位"] == 0:
                    slot = self.clock_ptr
                    found = True
                else:
                    owner_row["访问位"] = 0
                    self.clock_ptr = (self.clock_ptr + 1) % self.n
                loops += 1
            self.clock_ptr = (self.clock_ptr + 1) % self.n

        # Perform eviction on slot
        owner_pid, owner_row = self.find_frame_owner(slot)
        if owner_row:
            evicted_page = owner_row["页号"]
            if owner_row["修改位"] == 1:
                wrote_back = True
            owner_row["标志"] = 0
            owner_row["主存块号"] = None
            owner_row["访问位"] = 0
            owner_row["修改位"] = 0

        # Load new page
        row["标志"] = 1
        row["主存块号"] = slot
        row["loadTime"] = current_time
        row["lastUsed"] = current_time
        row["访问位"] = 1
        row["修改位"] = 1 if is_write else 0
        self.frames[slot] = page

        return False, evicted_page, wrote_back, slot

    def get_state_dict(self) -> dict:
        return {
            "frames": self.frames,
            "page_tables": self.page_tables,
            "clock_ptr": self.clock_ptr,
            "process_refs": self.process_refs,
            "process_ptrs": self.process_ptrs,
        }
