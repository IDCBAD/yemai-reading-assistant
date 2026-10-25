# OpenRouter 意群分析样本：官方文档人工判读

日期：2026-10-23
范围：只读 OpenRouter 官方文档文本，对可用于下一轮模型测试的句法/语义点做人工标注建议。本文不调用 WorkOS、不读扩展凭据，也没有验证网页当前 DOM 或插件实际发送的文本。

## 结论先行

用户贴出的 `zero-completion-insurance` 片段可以与官方原文作可读层面的对照；尚未拿到对应的精确输入快照，因此没有完成生产输入校验。当前可以检查分类是否传达了原句关系，不能判断未着色内容究竟未被提取还是被模型选择留白。

当前提示词把 condition 定义为真实的限制条件或假设。按这个定义，**“For text-to-speech requests”** 与 **“For image generation requests”** 是按请求类型限定规则适用范围，可归入 condition 有语义依据；但把它们和 if/when 子句同类呈现，可能让学习者看不出“类型范围”和“事件条件”的差别。相比之下，**“On your activity page”** 说明查看位置/场景，不限制该规则何时成立；标为 condition 更明确地超出了这个类别。评估记录应区分“可辩护但教学表达过宽”和“明显不属于限制/假设”。

更重要的条件是“某种响应状态成立时才适用”的条件；更重要的原因/结果是失败、有效输出与账单处理之间的关系。输出对范围短语十分积极，却漏掉或没有显示部分限制性内容。由于没有本轮页面 DOM、实际发送文本和对应请求记录，不能判断这些缺失来自正文提取、模型的稀疏选择，还是用户复制结果时省略；应把它们列为下一轮重点核验，而不是现在判成模型错误。

## 四篇官方页面及建议样本

### 1. Zero Completion Insurance

来源：[官方页面](https://openrouter.ai/docs/guides/features/zero-completion-insurance)

值得测试的 3 处：

1. 概述首段说明“无输出 token”与“空 finish reason 或错误”并列，随后给出免收模型 token 费用的结果；句首范围为所有失败/空响应的保护，不要把“即使底层 provider 收取 prompt processing”误当成该规则的第二个条件。建议检查模型是否保留 `no output tokens` 与 `either ... or ...` 的并列关系，以及让步补充 `even if ...`。
2. “How It Works”先说适用范围覆盖所有请求、模型和 provider，再以满足两类条件之一为前提得出不扣 token credits；其下两条是 **零 completion tokens 且空/空值 finish reason**，或 **error finish reason**。第一条内部是 AND，两个列表项之间是 OR。页面概述首段则把“没有输出 token”作为前置，再接空 finish reason 或错误。概述句与列表在 error finish reason 上的文字范围并不完全相同；这是官方来源自身的表述差异，本轮只记录，不推断成模型改写或自行补造。
3. “What Is Covered”关于 TTS、图像生成的说明是定义与限定条件混合段落；账单结果还随“可用输出是否达到标准”而异。此页适合检验定义、至少一个（`at least one`）、并列（`or`）、排除（`does not`）、让步（`even when`）与例子是否区分，而不是期待每个名词短语都单独着色。

### 2. Models

来源：[官方页面](https://openrouter.ai/docs/guides/overview/models)

值得测试的 3 处：

1. `output_modalities` 段：省略参数时默认仅返回文本模型；非文本输出（图片生成、embedding、decision models）不会出现在默认响应里，除非显式指定 modality 或 `all`。这是“默认行为 → 被排除的类别 → 如何改变结果”的对比链，不要把举例误标成触发条件，也不要漏掉 `unless/when omitted` 的默认范围。
2. Pricing Overrides：有些端点在特定条件下价格不同；长上下文超过 token 阈值、或处于某个时段，是两类不同例子。对象中的条件字段要全部匹配才应用；多个适用条目按后项覆盖相应价格；缺失字段沿用基础价格。这里适合测 `or` 举例与 `all` 必要条件，并列键值之间“覆盖/继承”关系不能误读成因果。
3. 定时价格段：文档说明时间窗条目不重叠且覆盖完整周期，因此任一时刻恰好有一条生效，消费者不需要 fallback。后面用 16:30–00:30 UTC 半价作例子。模型需要保留“范围完整 → 恰有一条匹配 → 因此无需 fallback”的推导，并把例子从一般规则中分开。

### 3. Model Fallbacks

来源：[官方页面](https://openrouter.ai/docs/guides/routing/model-fallbacks)

值得测试的 3 处：

1. `models` 参数允许在首选模型的 provider 宕机、限流，或因内容审核拒绝响应时尝试其他模型。这里三个触发情况以 OR 并列；fallback 的重试对象是其他模型，不是简单说同一模型换 provider。应关注平行枚举以及 `if` 条件的主从关系。
2. “How it works”：模型 ID 数组按优先顺序排列；首个模型返回错误时才自动尝试下一个。核心结构是“按顺序”加触发条件，不应把数组中的模型描述成同时调用。
3. “Pricing”：最终采用哪个模型就按哪个模型计价；若免费模型后面列了付费模型，且请求 fallback 到付费模型，费用按付费模型计算；若要确保请求免费，只列 `:free` 模型。这里包含条件、结果和目的建议，模型需避免把“列出付费模型”说成必然收费。

### 4. Structured Outputs

来源：[官方页面](https://openrouter.ai/docs/guides/features/structured-outputs)

值得测试的 3 处：

1. 首段说结构化输出适用于兼容模型，并保证响应遵循特定 JSON Schema。这里“兼容模型”是范围/适用对象，不是每一个模型都被保证支持；句子中的用途“particularly useful when...”是适用场景，不是开启功能的必要条件。
2. Model Support 段：只支持部分模型；具体支持是按 endpoint 而不只是模型判定。同一个模型可由多个 provider 提供，只有部分 endpoint 支持；而支持情况也可能随时间变化。后续三步建议先查模型参数、再要求 provider 只路由到支持所需参数的 endpoint、最后在请求里带 schema。需要保留“model 与 endpoint 的转折/限定”及三步先后。
3. Best Practices：schema 描述可帮助模型理解属性；strict 模式只会让具有原生 strict mode 的 provider 精确执行 schema。不同 provider 的执行方式有差异，有些保证符合 schema，有些转换或把 schema 作为强提示，因此不能保证每个 endpoint 都精确符合；strict mode 还可能限制可用的 JSON Schema 功能。这个段落是测试条件、让步/对比和否定范围的好样本，不应把“Set strict true”泛化成普遍保证。

## 对用户当前输出的逐点复核

人工核对的来源是 Zero Completion Insurance 官方页面的“ What Is Covered”及“Viewing Protected Requests”正文。以下以用户贴出的 JSON 为模型输出，以该官方页面为语义参照；由于没有精确输入快照，所有“漏掉”都只表示**当前贴出的结果没有覆盖**，不判定是模型漏选还是输入没有包含。

### p8：TTS 范围、定义、必要条件与分支

- `For text-to-speech requests` 是按请求类型限定适用范围。按提示词“真实限制条件”的定义，标为 condition 有合理依据；它不是事件型 if 条件。若产品教学目标需要显出两者区别，应在人工备注记录“范围限制”，而非把当前类别判成必错。
- `usable output means ... format-valid audio` 是核心定义；“at least one complete MPEG frame for MP3 **or** one complete sample for PCM”给出两个格式相依的最小可用输出标准。`or` 两侧要保留，MP3/PCM 是例示分支，不是原因。
- 原文紧接着说明 empty/invalid/truncated output 不收费；当前 p8 输出没有呈现这组反面情况。若它确实在同一输入块内，这是很值得检查的选择遗漏。
- Character-priced 请求另有规则：只要交付可用音频，就按完整输入计价，即使客户端收到部分音频后取消。这里的 `once` 表示生效时间/条件；`including when` 是让步场景。用户输出的大方向可理解，但没有呈现“即使取消”这一限制性补充。
- 合理切分可以把定义和至少一个格式标准连成一组，也可以将 MP3/PCM 分开；不应将 `For ... requests` 单独视为已识别真正逻辑条件。

### p9：图像输出及验证边界

- `For image generation requests` 同样是按请求类型限定规则适用范围。它可符合 condition 的宽泛定义，但与“请求是否交付了可用图像”这一事件条件属于不同层次；分类可接受，教学提示可进一步区分。
- `usable output means ... at least one image whose base64 payload is non-empty and decodable` 是一条定义，后半定语限制 image。单独高亮“whose base64...”可接受，但标签 `detail` 只表达补充而未必说明“这是有效输出所必须满足的条件”。可接受切分应保留它和 `at least one image` 的依附关系。
- 后两句是关键的否定/范围限制：只检查 base64 可解码性，**不**检查解码后的字节格式，因此 AVIF/HEIC 也正常交付。用户结果把句子拆成检查项、否定项和格式例子，结构大体可接受；应检查 whether `only` 的限制被保留，及 “so” 的推论是否可读。
- 页面还说无图像数据、空 payload、无效 base64 会被拒绝且不计费。当前结果没有呈现该失败分支；若输入含有它，需作为可能漏项审查。也要避免让模型把 `non-empty and decodable` 的 AND 拆成彼此独立可选条件。

### p10：名词列举、括号插入语与主谓跨度

- 主干应读作：不覆盖已经运行过的辅助服务费用；网页搜索工作、文件解析/PDF OCR、网页抓取的费用仍可能按实际工作收费，即使模型响应随后以错误结束。
- 用户输出把 `Work performed by web search` 标为 core，将括号内 per-request search fees 作 detail，再把后续列项连到 `may still be billed` 的谓语。两个 core 片段共同表达一个并列主语及其共享谓语；中间 detail 是括号例子。由于片段顺序仍可让读者把两个 core 合起来读，这种分组并非句法错误。
- 更不理想的边界是单独高亮第一项且不提示其与后文共享谓语的关系，或把括号例子当成另一项计费服务；在本例中，括号明确是 web search fees 的举例。短语可分开，但人工检查应确认并列项仍共同受 `may still be billed` 管辖。有限着色下也可以留掉普通列项，不必整句全标；只有确认实际输入包含、且系统选择了关键限制关系时，才讨论是否漏掉。
- `even when the model’s response subsequently ends in an error` 是让步/时间场景，不是导致费用产生的原因；条件“按实际完成工作计费”的依据不等于“模型错误导致收费”。
- 原文还补充某些故障（例如完全没有 token 的上游失败）也会跳过这些费用，以及已收费项显示在使用明细中。当前输出没有覆盖这两个句子；若在输入范围内，这是信息完整度问题。

### p12：位置语境、让步与真正 if 条件

- `On your activity page` 是页面位置/查看场景，不是账单规则成立的真实限制条件或假设。将它标成 condition 是本例中较明确的类别误配；`detail` 或留白更合适。
- 保护请求显示 token 使用扣款为零，是主句。下一句说这一点**即使在 OpenRouter 可能已经向 provider 支付 prompt processing 费用时也成立**；`even in cases where` 是让步。用户贴出的 p12 没有显示这个让步句，但由于没有精确输入快照，不能确定它在送入模型的 p12 中是否存在。
- “If a protected request also used auxiliary services ... only those service charges are deducted”才是真正 if 条件；`such as web search or file parsing` 是对 auxiliary services 的例子，`only` 是排他焦点。高亮应保留 if 从句与主句关联，例子可浅标或留白。
- 对产品现有 schema，更合适的切法是把 if 从句标为 condition，把结果主句标为 core；“such as...”可标 detail 或留白。不能把 `On your activity page` 标为同类真实条件，也不能丢掉 `only`。

## 人工判读规则与允许的差异

1. 先标出句子主干，再标从句关系：条件（if/when/once）、原因（because）、让步（even if/even when）、否定（not/does not）、并列（and/or）、例子（such as/e.g.）。这些字词通常决定关系；遗漏它们可能改变命题。
2. 区分 **scope / scene** 与 **condition**：`For image generation requests`、`On your activity page` 限定讨论在哪类请求/页面适用；它们不单独表达假设或触发事件。若现有结构只能四选一，可暂记为 detail 并在评估备注中标 scope，避免将 kind 名称当作真值。
3. 不要求每个段落全部着色。文档中重复标题、目录、导航、按钮、代码样例和普通支持句可留白；分数应把“合理稀疏省略”与“漏掉改变规则边界的条件/否定/例外”区分开。
4. 短语边界可以变化：例如核心主句可包含其直接宾语；紧密的定义与必要限制可以合并；括号例子可以留白。评价重点是原文顺序、关系范围和逻辑词保留，而不是只有一种金标准切法。
5. 本文的人工判断是为了下一轮比较样本，不是财务政策建议，也不替代 OpenRouter 条款解释。

## 给下一轮采集与调用的确认项

以下 4 个官方 canonical URL 已由官方文档导航/页面确认，可供主代理采集真实网页 DOM、抽取输入并逐页做一次受控 WorkOS 调用：

1. https://openrouter.ai/docs/guides/features/zero-completion-insurance
2. https://openrouter.ai/docs/guides/overview/models
3. https://openrouter.ai/docs/guides/routing/model-fallbacks
4. https://openrouter.ai/docs/guides/features/structured-outputs

在对比模型返回之前，需保存每页的实际发送段落文本及段落边界；否则 p8–p12 的空缺无法归因于抽取还是模型选择。可用人工关注点：scope 误标为 condition、嵌套限制词依附关系、并列项与共享谓语、真正条件与主句、否定/让步/例外是否保留。
