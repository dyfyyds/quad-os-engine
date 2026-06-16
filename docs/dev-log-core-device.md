# 开发日志：core-device 磁盘调度模块

**分支**：`core-device`
**日期**：2026-06-16
**提交**：`5283945`

---

## 一、目标

在 `core-device` 分支中设计完整的磁盘调度模块，实现与前面处理机/存储/资源模块的串联，预留接口供后续扩展。

## 二、实现内容

### 2.1 后端引擎增强（`backend/app/engines/disk_engine.py`）

| 功能 | 说明 |
|---|---|
| **8 种移臂算法** | FCFS、SSTF、SCAN、C-SCAN、LOOK、C-LOOK、F-SCAN、N-SCAN |
| **DiskGeometry 几何模型** | 柱面/磁道/记录/寻道时间/旋转时间/传输时间，可自定义 |
| **simulate()** | 完整 I/O 模拟：移臂调度 + 旋转定位 + 传输，返回分步轨迹 |
| **benchmark()** | 多算法基准对比：同一队列跑全部算法，返回对比指标 |
| **waypoints 机制** | 保留端点折返虚拟点，SCAN/C-SCAN 寻道距离计算正确 |

### 2.2 API 端点（`backend/app/api/disk.py`）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/disk/algorithms` | GET | 返回支持的算法列表（8 种） |
| `/api/disk/run` | POST | 纯移臂调度（兼容旧接口） |
| `/api/disk/simulate` | POST | **新增** 完整 I/O 模拟（移臂+旋转+传输） |
| `/api/disk/benchmark` | POST | **新增** 多算法基准对比 |

### 2.3 Schema 增强（`backend/app/schemas/disk.py`）

新增：
- `DiskGeometryConfig` — 磁盘几何参数配置
- `IORequestItem` — 单条 I/O 请求（进程名/柱面号/磁道号/物理记录号）
- `DiskSimulateRequest` — 完整模拟请求
- `DiskBenchmarkRequest` — 基准对比请求

### 2.4 前端接入（`frontend/src/mock/driver.js`）

- 磁盘调度从本地 mock 替换为调用后端 `/api/disk/simulate`
- 支持后端不可用时自动回退本地 SSTF 调度
- 使用 `diskBusy` 防并发保护

### 2.5 API 客户端（`frontend/src/api/client.js`）

新增 `diskSimulate` / `diskBenchmark` 方法。

### 2.6 预设场景（`backend/app/presets/data.py`）

新增 2 个磁盘预设：
- 密集请求序列（初始 100，可对比所有算法差异）
- 单方向聚集请求（展示 LOOK/C-LOOK 优化）

### 2.7 Docker 更新（`nginx/nginx.conf`）

- 超时从 120s 增加到 180s，适配 benchmark 端点
- 新增 `proxy_send_timeout` 和 `client_max_body_size`

## 三、测试结果

```
backend/tests/test_disk_engine.py  — 22 passed
backend/tests/test_api.py          — 12 passed
全部后端测试                        — 58 passed ✅
```

覆盖：
- 8 种算法的已知答案校验（Silberschatz 教材经典示例）
- 旋转调度（距离/时间计算）
- 几何参数 clamp
- benchmark 全算法对比
- simulate 完整 I/O 模拟
- 错误处理（未知算法 400）

## 四、串联说明

### 与处理机调度的串联
- I/O 请求中的 `进程名` 来自处理机调度的运行进程
- 当进程发起 I/O 时，生成磁盘请求入队

### 与存储管理的串联
- 磁盘几何参数（柱面/磁道/记录）对应外存地址
- 缺页中断时的外存读取可触发磁盘 I/O

### 预留接口
- `DiskGeometry` 可扩展更多物理属性（转速、磁头数等）
- `simulate()` 的 `geometry` 参数支持自定义时间模型
- `benchmark()` 支持自定义算法子集，可用于性能分析报告
- 后端 `/api/disk/simulate` 可对接真实磁盘遥测数据

## 五、Docker 验证

```
quados-backend    — healthy
quados-frontend   — running
quados-mysql      — healthy
quados-nginx      — running
```

访问：`http://localhost:8088`
API 文档：`http://localhost:8080/docs`

## 六、文件变更清单

```
modified: backend/app/api/disk.py
modified: backend/app/engines/disk_engine.py
modified: backend/app/presets/data.py
modified: backend/app/schemas/disk.py
modified: backend/tests/test_api.py
modified: backend/tests/test_disk_engine.py
modified: frontend/src/api/client.js
modified: frontend/src/mock/driver.js
modified: nginx/nginx.conf
```
