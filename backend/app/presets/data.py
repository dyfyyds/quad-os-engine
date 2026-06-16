"""教材例子预设场景（一键加载）。

来源：D:\\os\\OS 各实习文档中的示例数据，整理为各模块标准输入。
每条：{name, description, input}，input 即对应模块 /run 接口的请求体。
"""

PRESETS: dict[str, list[dict]] = {
    "scheduling": [
        {
            "name": "课堂示例（4 作业·含到达时间）",
            "description": "A(0,4) B(1,3) C(2,5) D(3,2)，可对比 FCFS/SJF/HRRN/优先级",
            "input": {
                "algorithm": "FCFS",
                "jobs": [
                    {"name": "A", "arrival": 0, "burst": 4, "priority": 3},
                    {"name": "B", "arrival": 1, "burst": 3, "priority": 1},
                    {"name": "C", "arrival": 2, "burst": 5, "priority": 4},
                    {"name": "D", "arrival": 3, "burst": 2, "priority": 2},
                ],
                "time_quantum": 2,
            },
        },
        {
            "name": "实习八作业表（5 作业·全 0 到达）",
            "description": "ZYA~ZYE，运行时间 0.3/0.5/0.1/0.4/0.1 小时（×10 取整）",
            "input": {
                "algorithm": "SJF",
                "jobs": [
                    {"name": "ZYA", "arrival": 0, "burst": 3},
                    {"name": "ZYB", "arrival": 0, "burst": 5},
                    {"name": "ZYC", "arrival": 0, "burst": 1},
                    {"name": "ZYD", "arrival": 0, "burst": 4},
                    {"name": "ZYE", "arrival": 0, "burst": 1},
                ],
                "time_quantum": 2,
            },
        },
    ],
    "disk": [
        {
            "name": "经典磁头序列（初始 53）",
            "description": "请求 98,183,37,122,14,124,65,67；磁道 0~199；初始递增",
            "input": {
                "algorithm": "SCAN",
                "requests": [98, 183, 37, 122, 14, 124, 65, 67],
                "head": 53,
                "disk_size": 200,
                "direction": "up",
            },
        },
    ],
    "paging": [
        {
            "name": "经典引用串（3 物理块）",
            "description": "7,0,1,2,0,3,0,4,2,3,0,3,2,1,2,0,1,7,0,1；可对比 FIFO/LRU/OPT/CLOCK",
            "input": {
                "algorithm": "LRU",
                "reference_string": [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2, 1, 2, 0, 1, 7, 0, 1],
                "frames": 3,
            },
        },
    ],
    "paging_translate": [
        {
            "name": "实习一·地址转换（块长 128，7 页）",
            "description": "页 0~3 在主存，指令序列演示地址转换与缺页中断",
            "input": {
                "block_size": 128,
                "page_table": [
                    {"页号": 0, "标志": 1, "主存块号": 5, "磁盘位置": "011"},
                    {"页号": 1, "标志": 1, "主存块号": 8, "磁盘位置": "012"},
                    {"页号": 2, "标志": 1, "主存块号": 9, "磁盘位置": "013"},
                    {"页号": 3, "标志": 1, "主存块号": 1, "磁盘位置": "021"},
                    {"页号": 4, "标志": 0, "主存块号": None, "磁盘位置": "022"},
                    {"页号": 5, "标志": 0, "主存块号": None, "磁盘位置": "023"},
                    {"页号": 6, "标志": 0, "主存块号": None, "磁盘位置": "121"},
                ],
                "instructions": [
                    {"操作": "+", "页号": 0, "单元号": 70},
                    {"操作": "+", "页号": 1, "单元号": 50},
                    {"操作": "×", "页号": 2, "单元号": 15},
                    {"操作": "存", "页号": 3, "单元号": 21},
                    {"操作": "取", "页号": 0, "单元号": 56},
                    {"操作": "-", "页号": 6, "单元号": 40},
                    {"操作": "移位", "页号": 4, "单元号": 53},
                    {"操作": "+", "页号": 5, "单元号": 23},
                ],
            },
        },
    ],
    "banker": [
        {
            "name": "经典 5 进程 3 资源",
            "description": "Available=(3,3,2)，安全序列 P1,P3,P4,P0,P2",
            "input": {
                "available": [3, 3, 2],
                "max": [[7, 5, 3], [3, 2, 2], [9, 0, 2], [2, 2, 2], [4, 3, 3]],
                "allocation": [[0, 1, 0], [2, 0, 0], [3, 0, 2], [2, 1, 1], [0, 0, 2]],
            },
        },
        {
            "name": "实习五·3 进程 10 同类资源",
            "description": "单类资源，总量 10；Available=3，安全序列 P1,P0,P2",
            "input": {
                "available": [3],
                "max": [[8], [5], [9]],
                "allocation": [[3], [2], [2]],
            },
        },
    ],
    "sync": [
        {
            "name": "生产者-消费者（缓冲 10）",
            "description": "交替生产/消费，信号量 s1=10,s2=0，不发生阻塞",
            "input": {
                "buffer_size": 10,
                "operations": [
                    {"type": "produce"}, {"type": "produce"}, {"type": "consume"},
                    {"type": "produce"}, {"type": "consume"}, {"type": "consume"},
                ],
            },
        },
        {
            "name": "缓冲区满阻塞演示（缓冲 2）",
            "description": "连续生产 3 次→第 3 次阻塞，消费 1 次唤醒",
            "input": {
                "buffer_size": 2,
                "operations": [
                    {"type": "produce"}, {"type": "produce"},
                    {"type": "produce"}, {"type": "consume"},
                ],
            },
        },
    ],
}
