# 历史文档归档

这里保存已经完成使命、但仍可解释版本演进、设计取舍或故障处理过程的资料。归档文件是历史证据，不是当前项目状态的权威说明。

当前事实请先阅读：

1. [项目交付与接管手册](../PROJECT_HANDOFF.md)
2. [可复用项目 SOP](../REUSABLE_PROJECT_SOP.md)
3. [领域语言](../../CONTEXT.md)

## 使用规则

- 不根据归档文件中的分支、测试数量或“待提交”描述判断当前状态。
- 需要理解某项历史决策时，先从交付手册进入，再按链接查阅归档证据。
- 归档内容原则上保持原样；只有安全问题、断链说明或明显损坏才应修改。
- 归档文件移动后，原路径和归档原因记录在下表中。

## 归档地图

| 原路径 | 当前路径 | 类型 | 归档原因 |
| --- | --- | --- | --- |
| `docs/V0.3_ACCEPTANCE.md` | `releases/V0.3_ACCEPTANCE.md` | 版本验收快照 | 记录 v0.3 当时的门禁与未完成项，不再代表当前主线状态 |
| `docs/V0.4_ACCEPTANCE.md` | `releases/V0.4_ACCEPTANCE.md` | 版本验收快照 | 保留阅读卡片版本的真实回归证据 |
| `docs/V0.4.1_ACCEPTANCE.md` | `releases/V0.4.1_ACCEPTANCE.md` | 版本验收快照 | 文件末尾的提交状态已经过时，但验收与性能数据仍有价值 |
| `docs/V0.5_ACCEPTANCE.md` | `releases/V0.5_ACCEPTANCE.md` | 版本验收快照 | 自动门禁有效，人工回归勾选与当前 Git 状态不一致 |
| `docs/IMPLEMENTATION_PLAN.md` | `plans/IMPLEMENTATION_PLAN.md` | 阶段计划 | MVP 实施计划已经完成，不能继续充当当前路线图 |
| `docs/superpowers/specs/2026-08-08-composer-agent-queue-design.md` | `plans/2026-08-08-composer-agent-queue-design.md` | 交互设计 | 队列与输入框方案已经实现，保留用于解释状态模型与动效选择 |
| `docs/WORKOS_STREAMING_REFACTOR_NOTES.md` | `investigations/workos/WORKOS_STREAMING_REFACTOR_NOTES.md` | 调查记录 | 记录 v1/v2 流式调查过程，当前约束已收敛到现行迁移文档 |
| `docs/workos-stream-issue-report.md` | `investigations/workos/workos-stream-issue-report.md` | 故障报告 | 保留公开 v1 多轮 SSE 异常证据 |
| `docs/workos-v2-sequential-stream-test.py` | `investigations/workos/workos-v2-sequential-stream-test.py` | 诊断脚本 | 协议验证工具，不属于正式运行链路 |
| `docs/design/file-type-icon-concept-v1.svg` | `design-concepts/file-type-icon-concept-v1.svg` | 视觉概念 | 未被生产代码引用的概念资产 |
| `docs/design/file-type-icon-concept-v1.png` | `design-concepts/file-type-icon-concept-v1.png` | 视觉概念 | 未被生产代码引用的概念资产 |

## 仍在现行目录中的专项文档

- [产品需求与边界](../PRODUCT_SPEC.md)
- [技术架构设计](../TECHNICAL_DESIGN.md)
- [统一上下文工作台](../context-workbench-architecture.md)
- [IndexedDB 迁移约束](../INDEXEDDB_MIGRATION.md)
- [WorkOS v2 传输迁移](../WORKOS_V2_TRANSPORT_MIGRATION.md)
- [WorkOS Agent 协议说明](../WORKOS_AGENT_PROMPT.md)
- [发布检查清单](../RELEASE_CHECKLIST.md)

