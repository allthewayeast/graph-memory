# DSH 兼容性维护：1.6.0-beta.17

本次修复 #113、#117，以及 #114 中已确认的写锁等待缺口。保留最近 N 轮、摘要/SPO 导航、精确来源召回和跨会话记忆的产品策略不变。

| 模块 | 根因 | 修复落点 |
|---|---|---|
| V4 消息来源 | 插件仍写入 `{kind:"plugin",plugin:"graph-memory"}`，宿主拒绝持久化 | `src/format/dsh-source.ts` 统一写 `{kind:"plugin:graph-memory"}`；读取兼容 V3/V4 |
| 旧前缀和工具轨迹 | 两处 `session.append` 使用旧来源 | `dsh-compaction.ts`、`dsh-turn-projection.ts` 共用来源函数 |
| 召回快照 | `decision.messages` 也被宿主落盘，原来的回归测试漏掉该路径 | `dsh.ts` 使用同一来源函数；直接验证注入消息的 V4 合同 |
| 抽取请求 | 一次性请求混入 Session 的身份字段 | 请求消息只发送 `role/content`，不提供 `id/source` |
| 推理档位 | 无条件发送 `off`，无法适配不支持关闭推理的模型 | `src/engine/dsh-extraction-route.ts` 查询 `ctx.llm.resolveModelInfo(provider,model,signal)` |
| 失败状态 | provider/档位错误被当成坏数据永久隔离 | 这类错误保留 `pending`，日志输出具体原因；手动 drain 遇到错误即停止，避免无限重试 |
| 可观测性 | 用户只能在数据库中找到错误详情 | 宿主日志显示原因；`gm_status` 显示最近未恢复错误 |
| SQLite 并发 | `busy_timeout=0`，写锁争用立即失败 | `openDb/getDb` 共享可配置的写锁等待策略，先设置再执行 journal 配置和迁移 |

## 模型能力如何决定抽取档位

1. 用户显式配置 `llmReasoningEffort`：必须属于该模型声明的档位，否则保留待处理原始问答并告警。
2. 用户未配置：支持 `off` 就使用 `off`；否则使用宿主首个声明档位。
3. 模型无推理能力：不发送 `reasoningEffort`。
4. 旧版宿主没有 `resolveModelInfo`：未配置档位时沿用 provider 默认值。

档位 ID 属于 provider，不维护模型名单或枚举。宿主的展示顺序不保证是价格顺序；需要固定成本时可显式配置它支持的档位或专用抽取模型。能力查询不会发起额外的生成请求，每次成功抽取仍然只调用一次模型。原有 `summary/outcome/triples` 合同保持不变。

## 从旧版空记忆库恢复

升级不会主动扫描 DSH 全部历史会话，也不会自动解除所有隔离记录。以前已经存入 GM、但因为 `off` 被隔离的原始问答仍然保存在 `gm_messages`，可以复用已有恢复工具。

1. 安装 `github:adoresever/graph-memory#v1.6.0-beta.17`。
2. 删除不受支持的显式 `GRAPH_MEMORY_LLM_REASONING_EFFORT=off`，或者配置模型确实支持的档位。
3. 需要补提旧记录时，将插件配置设为 `assistantTools: all` 并重启宿主。
4. 先使用 `gm_status` 核实状态，再显式调用 `gm_retry_extraction`；可提供 `sessionId` 只恢复目标会话。
5. 该工具会重排目标范围内的隔离记录，并处理待抽取记录。这会产生补提模型费用；完成后可恢复 `assistantTools: none`。

新发生的路由/供应商错误保留 `pending`。原始问答不会因为配置错误被删掉，且没有自动 API 重试循环。原有显式抽取路由在宿主启动时恢复待处理记录的行为保持不变。

## SQLite 调整的范围

`dbBusyTimeoutMs` 默认 5000 毫秒，表示 SQLite 遇到其他连接的写锁时最多等待五秒。它是可配置的存储竞争策略，不是模型 Token 配额；`0` 明确选择立即报锁冲突。DSH 对应环境变量为 `GRAPH_MEMORY_DB_BUSY_TIMEOUT_MS`；OpenClaw 使用插件配置中的 `dbBusyTimeoutMs`。

初始化发生异常时立即关闭新建连接，避免插件加载失败后遗留句柄。保留 SQLite 的 `synchronous=FULL` 和默认 1000 页自动 checkpoint。WAL 文件约 4 MB 并不单独证明 checkpoint 失败：checkpoint 后 SQLite 通常复用其物理空间，而不是每次缩小文件。因此没有盲目改为 `synchronous=NORMAL` 或写死 200 页阈值；#114 的持续增长结论仍需要多连接读事务和实际未回写帧的证据。

## 本地验证

- 23 个测试文件、149 项测试通过。
- 用 DSH `0.2.0-rc.2` 官方 `assertV4RowAdmission` 对照：旧写法稳定被拒，新版真实生成的归档、轨迹和召回消息全部接受。
- 模型能力测试覆盖支持 `off`、仅有 `low/high/max`、无推理能力、自定义档位及旧版能力 API；成功路径只发起一次生成调用。
- 显式不支持的档位不产生生成调用，保留 `pending`；修正能力后用原有工具成功补提。
- 供应商错误不触发自动重试；坏结构仍被原有字段合同校验拒绝。
- 使用 Node Worker 的独立 SQLite 连接真实持有写锁，验证插件等待锁释放后两次写入都保留。
- 在独立临时 DSH_HOME 中，用官方 DSH `0.2.0-rc.2` 安装本地 npm tarball，配置组合包含 graph-memory；Web 服务启动后插件数据库完成 16 个迁移、`quick_check=ok`。随后正常停止服务并卸载测试插件。

20 轮 GLM-5.2 数据沿用 2026-09-09 实测。本次是确定性兼容与存储修复，没有重跑付费基准，也没有根据缓存命中率扩大上下文窗口。

## 移植到另一个项目

在原有[导航升级指南](TURN_MEMORY_NAVIGATION_UPGRADE_CN.md)基础上补入：

1. `dsh-source.ts`，将所有持久化入口接入共同来源函数；识别历史来源时使用 `isDshMemorySource`。
2. `dsh-extraction-route.ts`，把能力查询放在实际抽取路由选定之后；配置错误与字段合同错误分别保存状态。
3. `db.ts` 的 `DatabaseOptions` 与初始化异常关闭逻辑，将宿主配置接到同一个数据库边界。
4. 重新生成并提交 `dist`，保持 GitHub 直装用户无需在本机执行构建脚本。

测试只验证宿主与数据合同、写锁及恢复行为，不增加三元组方向、数量或语义门禁。
