"""实验报告导出服务：SimulationTrace → Markdown。

Markdown 为主（含输入回显、指标表、分步过程表、最终状态）；
PDF 由前端「打印为 PDF」兜底，后端暂不引入重型渲染依赖。
"""
from __future__ import annotations

import json
from datetime import datetime

from app.schemas.common import SimulationTrace

MODULE_NAMES = {
    "scheduling": "作业调度",
    "banker": "资源分配·银行家",
    "paging": "页面置换",
    "disk": "磁盘调度",
    "sync": "进程同步·PV",
}


def _json_block(obj) -> str:
    return "```json\n" + json.dumps(obj, ensure_ascii=False, indent=2) + "\n```"


def _kv_table(d: dict) -> str:
    rows = ["| 指标 | 值 |", "| --- | --- |"]
    for k, v in d.items():
        if isinstance(v, (list, dict)):
            v = json.dumps(v, ensure_ascii=False)
        rows.append(f"| {k} | {v} |")
    return "\n".join(rows)


def to_markdown(trace: SimulationTrace) -> str:
    name = MODULE_NAMES.get(trace.module, trace.module)
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    parts = [
        f"# 实验报告 · {name} · {trace.algorithm}",
        f"> 生成时间：{now}　|　平台：Quad-OS 调度模拟平台",
        "",
        "## 输入参数",
        _json_block(trace.input_echo),
        "",
        "## 调度指标",
        _kv_table(trace.metrics),
        "",
        "## 分步过程",
        "| 步 | 说明 |",
        "| --- | --- |",
    ]
    for s in trace.steps:
        parts.append(f"| {s.index} | {s.description} |")

    parts += ["", "## 最终状态", _json_block(trace.final_state), ""]
    return "\n".join(parts)
