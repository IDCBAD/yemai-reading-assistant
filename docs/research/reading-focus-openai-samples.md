# OpenAI 研究页面的辅助阅读测试样本

研究日期：2026-10-23
范围：OpenAI 自有研究页面、官方论文和 System Card。本文为候选样本调查，不表示这些页面已经送入 WorkOS 或被插件分析。

## 结论

建议先用四个 OpenAI HTML 页面做第一轮采集：

1. [Why language models hallucinate](https://openai.com/index/why-language-models-hallucinate/)：连续说明、类比、反例、表格和总结并存，适合看模型能否选择重点，而不是把文章涂满。
2. [Understanding neural networks through sparse circuits](https://openai.com/index/understanding-neural-networks-through-sparse-circuits/)：技术长文含图示、图注、“Show more”按钮和多级解释，适合定位正文提取是否混入图注/按钮或漏掉被折叠内容。
3. [Evaluating AI’s ability to perform scientific research tasks](https://openai.com/index/frontierscience/)：含嵌套目录、样例问题、评测说明及限制，适合看目录重复、列表和正文边界。
4. [Trading Inference-Time Compute for Adversarial Robustness](https://openai.com/index/trading-inference-time-compute-for-adversarial-robustness/)：研究问题、实验设计、图像图表、枚举和限制段落俱全，适合检验图表周围文本及转折关系。

这四篇覆盖解释型研究、机制研究、基准评测和安全研究。建议第一轮把每篇页面实际抽取出的段落与人工浏览的正文逐段核对，再调用 WorkOS；若输入漏掉/夹入内容，先修正文抽取，不要先调意群提示。

## 候选页面

| 优先级 | 官方页面 | 为什么适合 | 页面结构风险 | 采集注意 |
|---|---|---|---|---|
| 1 | [Why language models hallucinate](https://openai.com/index/why-language-models-hallucinate/) | 论证脉络清楚：现象、测试激励、统计解释、建议与总结；同时有对比例子和模型指标表。官方页正文举例说明准确率与错误率可能冲突，并含一个多列比较表。 | 正文前有导航、目录与“Read the paper”；目录可能与正文标题重复。结果表在纯文本读取中会扁平化，表格单元格关系可能丢失。 | 以 HTML 正文段落为主；表格不要伪装成普通句子发给意群分析，另行记录为结构风险。 |
| 2 | [Understanding neural networks through sparse circuits](https://openai.com/index/understanding-neural-networks-through-sparse-circuits/) | 解释“稀疏模型 → 电路 → 能力与可解释性”的多层因果/对照，术语密度和长短句变化大。页面含模型图、散点图、代码例子与“Show more”控件。 | 图注和可访问文本可能混入正文；多个“Show more”可能表示折叠扩展文本，普通 DOM 抽取或屏幕可见文本会不一致；图表本身不等于文字段落。 | 记录页面在当前滚动/展开状态下抽取了什么；不要把图的 alt 文本重复当正文。页面的官方说明明确将可解释性定义、方法、评估和局限分为多个章节。[页面来源](https://openai.com/index/understanding-neural-networks-through-sparse-circuits/) |
| 3 | [Evaluating AI’s ability to perform scientific research tasks](https://openai.com/index/frontierscience/) | 有 benchmark 定义、两个赛道、样例问题、评分方式、结果和限制，适合研究摘要以外的长文章阅读。官方页面列出嵌套章节目录，并在正文解释 Olympiad 与 Research 两条赛道。 | 页面顶部目录含二级条目，目录文字可能重复正文标题；样例题可能是长列表/独立卡片；结果部分可能含表格、图或题目模块。 | 先核对目录、样题卡片是否被识别为阅读段落；按正文自然顺序采集，标题单独留存以便核查。 |
| 4 | [Trading Inference-Time Compute for Adversarial Robustness](https://openai.com/index/trading-inference-time-compute-for-adversarial-robustness/) | 围绕研究问题、实验、结果、例外与限制展开，适合检验因果、让步、限定条件。页面本身介绍多类攻击和任务。 | 多张热力图/折线图及重复图注；图注可能被拆为多个相似文本块，数字和图轴标签在纯文本中难以还原。 | 优先检查引导图的解释段和限制部分；不要以颜色分析/图表文字为模型语义质量的唯一证据。 |
| 5 | [MLE-bench](https://openai.com/index/mle-bench/) | 短而紧凑，直接给出 benchmark 构成、评估过程、关键结果和开放代码链接，可作为“短正文/信息密集”对照。 | 实际 OpenAI HTML 页面相对简短，主要是介绍与结果摘要；下方很快进入标签、作者和全站导航。若抽取器误把导航也发入输入，容易在这篇上被看出来。 | 作为短文对照，不应把“文章短、返回少”直接判断为 API 丢数据；若想测论文全文，需另行选择官方 Read paper PDF/arXiv 入口。 |
| 6 | [Learning to reason with LLMs](https://openai.com/index/learning-to-reason-with-llms/) | 有技术介绍、基准表现、评测、安全和结论，句式与评价/限定关系丰富。 | 页面抓取结果显示 1706 行，顶部包含重复目录、图表说明和“Loading…”占位；正文还插入模型状态的后续更新，且写明旧版 o1 已弃用，属于历史发布页。 | 适合长页边界压力测试；结果需区分原始文章内容、更新提示、图表说明与导航，不宜用来评判当前模型事实是否新。 |
| 7 | [Early experiments in accelerating science with GPT-5](https://openai.com/index/accelerating-science-gpt-5/) | 多领域案例长文，含科学研究协作、文献检索、证明、案例贡献与限制，可检测长文章的段落顺序和案例内主张/依据/限制关系。 | 页面有目录、多级案例标题、长篇嵌套案例、外链和大量“Read more on page …”PDF链接；案例卡片内容可能既出现在摘要又在后文展开。 | 先检查案例摘要是否重复、是否跨标题错接；若限制段丢失，模型会倾向过度正向概括。官方页面称这些案例是精选说明而非系统抽样，并明确列出专家监督和引用幻觉等限制。[页面来源](https://openai.com/index/accelerating-science-gpt-5/) |
| 8 | [GPT-4o System Card (PDF)](https://cdn.openai.com/gpt-4o-system-card.pdf) | 33 页安全评估报告，涵盖能力、局限、风险评测，提供与 HTML 研究文章不同的文档类样本。 | PDF 页码、脚注、表格、分页/断行、脚注标记；网页插件正文识别可能根本不读取嵌入 PDF。双栏或跨栏顺序也应现场确认，不可假设。 | 只作为 PDF/文档支持能力单独测试，不与 HTML 正文抽取质量混为一谈。 |

## 已核对的原文证据

- OpenAI 官方 `Why language models hallucinate` 页面包含准确率、弃答率、错误率并列的表格，以及其后说明这些指标之间的区别；章节目录列出“Teaching to the test”“How hallucinations originate…”和结论。这是检验比较/因果/让步与表格边界的直接证据。[官方页面](https://openai.com/index/why-language-models-hallucinate/)
- `FrontierScience` 官方页包含嵌套目录，正文区分 Olympiad 与 Research 赛道，并介绍 benchmark 的设计与结果，适合作为带目录和内容模块的 HTML 样本。[官方页面](https://openai.com/index/frontierscience/)
- `Trading Inference-Time Compute` 官方页包含多类实验和重复图表说明；正文明确写出性能改善存在例外，并有独立限制章节。抓取结果把图像替代文字、图注和重复说明也暴露出来，说明结构可能影响输入。[官方页面](https://openai.com/index/trading-inference-time-compute-for-adversarial-robustness/)
- `Learning to reason with LLMs` 的当前官方页面保留历史发布内容，同时在正文附近标注当前访问信息已变更，并提供重复目录和评测图表说明，适合测试“正文/后续更新/目录”区分。[官方页面](https://openai.com/index/learning-to-reason-with-llms/)
- `GPT-4o System Card` 官方 PDF 显示 33 页，并含脚注标记、分页文本和评估章节，验证 PDF 是否进入扩展读取范围应独立进行。[官方 PDF](https://cdn.openai.com/gpt-4o-system-card.pdf)

## 对“输入问题还是模型问题”的判断方法

这批样本可帮助区分三个环节，避免仅凭彩色高亮反推原因：

1. **网页正文抽取**：保存送 WorkOS 前的文章段落列表。与浏览器页面人工核对遗漏、重复、导航污染、列表/标题/图注误归段落。若这一步不一致，属于输入采集问题。
2. **分析返回**：用相同正文快照记录 WorkOS 原始 JSON。验证段落 ID、原文片段和类型，区分模型没返回与客户端无法定位。
3. **页面渲染**：核对原始 JSON 片段与实际颜色标记范围。JSON 正确而高亮错位才指向渲染；JSON 与原文一致但关系分类/选取不佳，才主要是提示或模型判断问题。

建议第一轮只取上面 4 个 HTML 页面，各留一份抽取快照和一次 WorkOS 原始返回，并标记对应页面结构风险。优先选择“正文是否完整、段落顺序是否对、目录/图注是否混入”的证据，再评估意群覆盖率与语义质量。真实 WorkOS 调用会创建远端会话并消耗其服务资源；本文没有发起任何调用。

## 资料限制

本次读取来自 OpenAI 官方 HTML 页面及 OpenAI CDN 上的官方 PDF；网页读取器返回的是可读正文/索引视图，不等于浏览器 DOM 快照，也不代表全部页面内容都已下载。本文没有访问用户的 WorkOS，也没有查看 `C:\Users\xiao_\Desktop\测试用例` 中的本地案例。OpenAI 页面会更新；o1 发布页尤其包含历史信息，采集时应记录日期及最终URL。
