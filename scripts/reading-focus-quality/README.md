# 意群固定用例检查

此工具不调用模型、不发送网络请求。它用生产 `parsePageReadingAnalysis` 检查原文定位，再检查明确列出的阅读要求。通过数量是这些要求的检查结果，不是模型准确率；也不证明新提示已经改善真实服务。

14 个用例包含用户提供文章中的 p1、p5、p12、p24、p49、p55、p0、p37，以及 6 个新编迁移用例。前 10 个用例保留主干、否定、必要补语、条件／原因和并列选择检查；新增的 p0、p37 及两个多句迁移段落检查关系说明、目的、两处插入式举例与选择性着色。

人工参考 `referenceGroups` 只用于检查工具本身，不冒充模型返回。它展示一种合法的选择，并不是唯一切分答案。片段可比参考更大，只要完整包含要求的原文、类型一致，并且不把要求分开的角色合成一个片段。p0 参考只显示第一句的主干、关系说明与目的；p37 选择第二句的并列框架／两处举例及末句完整对比。分析整段不等于必须给每句全部着色，已显示片段仍应保留必要宾语、补语、否定和情态含义。

```powershell
node --test scripts/reading-focus-quality/evaluation.checks.mjs
node scripts/evaluate-reading-focus-quality.mjs --reference
node scripts/evaluate-reading-focus-quality.mjs --write-prompt output/reading-focus-quality-prompt.txt
node scripts/evaluate-reading-focus-quality.mjs --response output/new-model-response.json
node scripts/evaluate-reading-focus-quality.mjs --baseline '<旧文章返回文件>'
```

`--response` 要求全套用例；未返回的用例会失败。`--baseline` 只检查旧文件中已经存在的固定用例 ID，忽略其余文章段落，报告选择数量、忽略数量和未测迁移用例。两种范围的通过数不能直接当作同一项全量比较。新旧真实返回应使用相同的导出输入及 `--response` 模式进行比较。也可对同一旧文章的两份真实返回分别使用 `--baseline`，确认两份报告选择的是相同用例。

JSON 输出包含每项用例的错误、跳过说明、检查通过／总数、着色覆盖率 `coverage`、最长蓝色片段词数 `maxCoreWords` 及适用的 `limits`。词数按连续字母／数字及词内连字符、撇号计算。

只有明确设置 `maxCoverage` 或 `maxCoreWords` 的用例才据此判失败。新增的四个长段落目前分别设为 0.75 和 18，用来捕获这些固定样例的全文涂色、过长混合主干；它们不是所有英文的正确率标准，也不截断、删除或重分类真实返回。短完整句允许 100% 着色，原 p1 的并列条件／选择也可以超过 90%，不能为了密度剪断有必要的信息。

`diagnostics.selectedLengthyProseOver90` 单独记录被选用例中超过 90% 着色的长段落。这里的长段落仅按至少 120 字符、两个句末标点粗略识别，用于观察，不增加失败项；不是全篇密度统计，也不判断语法。CLI 在有失败或未选中任何用例时返回退出码 1。

扩大用例后的同范围旧返回基线为：v1 **29/48**，v2 **38/48**，均选择上述 8 个文章用例，6 个迁移用例未测。只保留原来的 6 个文章用例比较，仍为 v1 **18/30**、v2 **30/30**。新增要求指出 v2 的 p0 缺少独立的关系说明和目的、p37 两处举例被并入主干，二者均约 97.7% 着色；这说明原要求通过不代表全篇阅读质量已达标。不要把 38/48 与先前 18/30 直接比较。人工参考 14 个用例为 **78/78**，仅证明检查工具及参考能满足这些固定要求，不说明新提示已改善真实模型。
