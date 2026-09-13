# 策略评测样本（S05-B）

这里放**脱敏后的真实标注样本**，每条一个 JSON 文件（或一个 JSON 数组）：

```json
{
  "id": "unique-sample-id",
  "category": "code",
  "shouldReview": true,
  "expectedPhases": ["compare", "final"],
  "events": [ /* 脱敏后的 SessionEvent 数组 */ ]
}
```

- `category` 只能取 `code` / `research` / `writing` / `candidates` / `long-task` / `conversational`。
- `shouldReview` 是人对"这个任务本应触发独立评审吗"的判断；`expectedPhases` 是应当使用的阶段（`compare` / `select` / `track` / `final`），可选。
- `events` 是会话事件日志（`user/message`、`tool/call`、`tool/result`、`todo/write` 等）。发布或提交前必须脱敏。

运行离线回放（无模型调用）：

```bash
pnpm run build
node scripts/eval-replay.mjs --samples samples/strategy
```

它报告触发 precision/recall 与各阶段覆盖，以及 `~/.dsh/sessions` 下已记录的路由周期汇总。**真实模型对比**（manual / 当前 smart / 新 smart 的额外调用、延迟与误放行）需要先选定数据与调用预算，尚未包含在脚本中，见 README「离线回放评测」。
