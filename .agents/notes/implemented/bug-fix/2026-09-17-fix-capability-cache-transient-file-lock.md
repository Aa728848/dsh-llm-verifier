# Agent Note: 修复 Windows 下能力缓存持久化瞬态文件锁冲突

Status: implemented

## Problem
在执行发布脚本或全量单测时，`src/top-logprobs.test.ts` 中的用例 `keeps the freshest mark when hydration races an in-process probe` 偶发失败（`expected 1789656364273 to be greater than or equal to 1789656369273`）。
原因在于 Windows 平台下，文件刚被写入或读取后，文件句柄与反病毒/索引扫描器可能造成毫秒级的共享占用冲突。`TopLogprobCapabilityCache.writeDocument` 采用固定的 `.tmp-${process.pid}` 命名且直接调用原生 `rename`，缺乏重试机制。当遇到 `EPERM` / `EBUSY` / `EACCES` 瞬态锁时，错误在末尾被当作 best-effort 吞掉，导致更新后的 probe 时间戳未能成功覆盖落盘，`flush()` 掩盖了写入失败，后续读取断言读到旧时间戳引发失败。

## Decision
1. 对齐 `src/cache.ts` 的成熟做法，在 `src/top-logprobs.ts` 中引入 `TRANSIENT_REPLACE_CODES`（`EPERM`, `EACCES`, `EBUSY`）以及最多 5 次退避重试的 `replaceFile` 辅助函数。
2. 临时文件引入全局自增序号 `replaceOrdinal`（`.tmp-${process.pid}-${++replaceOrdinal}`），消除同进程内不同写操作之间的临时文件名竞争。
3. 调整 `persist` 与 `forget` 的 Promise 链式调度，确保上一次操作的失败不会阻塞下一次写入，同时保障写操作按序完成。
4. 在 `src/top-logprobs.test.ts` 中补充连续快速调用 `markUnsupported` 的回归测试用例。

## Alternatives considered
- **不重试直接暴露错误**：若不重试而直接 throw，会导致在 Windows 环境下由于正常的文件索引或 Defender 扫描而偶发中断整个流程，破坏了能力探测结果 best-effort 降级的鲁棒性。
- **直接使用同步 `writeFileSync` 覆盖目标文件**：虽然避免了 `rename`，但破坏了原子写入（atomic replace）机制，若写入中途异常可能导致持久化文件损坏。

## Consequences
彻底消除了 Windows 环境下由于文件锁瞬态占用导致的 `top-logprobs.test.ts` 偶发失败，保证了全量测试和 `verify:release`（及 `npm publish`）的稳定性；与 `cache.ts` 的文件写入行为保持一致。
