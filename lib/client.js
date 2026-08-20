window.__ModuleLoader__.load({
	id: "dsh-llm-verifier",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client.tsx
		const NS = "llm-verifier";
		const shell = {
			width: "100%",
			maxWidth: 720,
			display: "flex",
			flexDirection: "column",
			gap: 12,
			padding: "0 0 32px",
			color: "var(--dsw-alias-label-primary)"
		};
		const settingsHeading = {
			margin: 0,
			fontSize: 16,
			fontWeight: 500,
			lineHeight: "24px",
			color: "var(--dsw-alias-label-primary)"
		};
		const settingsIntro = {
			margin: 0,
			fontSize: 14,
			lineHeight: "22px",
			color: "var(--dsw-alias-label-tertiary)"
		};
		const group = {
			width: "100%",
			display: "flex",
			flexDirection: "column",
			borderTop: "1px solid var(--dsw-alias-border-l2)"
		};
		const groupTitle = {
			margin: 0,
			padding: "18px 0 8px",
			fontSize: 14,
			fontWeight: 500,
			lineHeight: "22px",
			color: "var(--dsw-alias-label-primary)"
		};
		const row = {
			minHeight: 64,
			display: "grid",
			gridTemplateColumns: "minmax(180px, 1fr) minmax(230px, 288px)",
			gap: 24,
			alignItems: "center",
			padding: "12px 0",
			borderBottom: "1px solid var(--dsw-alias-border-l2)"
		};
		const selectStyle = {
			boxSizing: "border-box",
			width: "100%",
			height: 36,
			padding: "0 34px 0 12px",
			borderRadius: 8,
			color: "var(--dsw-alias-label-primary)",
			background: "var(--dsw-alias-bg-input)",
			border: "1px solid var(--dsw-alias-border-l2)",
			font: "inherit",
			fontSize: 14,
			lineHeight: "22px",
			outline: "none"
		};
		const toggleStyle = (enabled) => ({
			position: "relative",
			justifySelf: "end",
			width: 40,
			height: 22,
			padding: 0,
			border: 0,
			borderRadius: 999,
			cursor: "pointer",
			transition: "background .15s ease",
			background: enabled ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-bg-input)"
		});
		const toggleThumbStyle = (enabled) => ({
			position: "absolute",
			top: 3,
			left: enabled ? 21 : 3,
			width: 16,
			height: 16,
			borderRadius: "50%",
			background: "var(--dsw-static-neutral-00, #fff)",
			boxShadow: "0 1px 3px rgba(0,0,0,.28)",
			transition: "left .15s ease"
		});
		const dashboardCard = {
			border: "1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.13))",
			background: "color-mix(in srgb, var(--dsw-alias-bg-module, #171925) 88%, transparent)",
			borderRadius: 16,
			boxShadow: "0 12px 36px rgba(0,0,0,.12)"
		};
		const muted = {
			color: "var(--dsw-text-secondary)",
			fontSize: 12
		};
		const toolLabels = {
			verifier_compare: "两项对比",
			verifier_select: "多项优选",
			verifier_track: "进度跟踪",
			verifier_current_session: "会话验收"
		};
		const toolColors = {
			verifier_compare: "#4f8cff",
			verifier_select: "#8b6df6",
			verifier_track: "#2fc5c9",
			verifier_current_session: "#f5a524"
		};
		function record(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
		}
		function values(view) {
			const v = record(view.value);
			const mode = v.autoVerifyMode === "manual" || v.autoVerifyMode === "strict" ? v.autoVerifyMode : "smart";
			return {
				enabled: v.enabled !== false,
				autoVerifyMode: mode,
				autoVerifyThreshold: Number(v.autoVerifyThreshold ?? .65),
				autoVerifyRepeats: Number(v.autoVerifyRepeats ?? 1),
				autoVerifyMinToolCalls: Number(v.autoVerifyMinToolCalls ?? 3),
				autoVerifyMaxChars: Number(v.autoVerifyMaxChars ?? 8e4),
				autoVerifyMaxPerTask: Number(v.autoVerifyMaxPerTask ?? 2),
				autoVerifyMaxPerSession: Number(v.autoVerifyMaxPerSession ?? 8),
				provider: String(v.provider ?? ""),
				model: String(v.model ?? ""),
				...typeof v.reasoningEffort === "string" ? { reasoningEffort: v.reasoningEffort } : {},
				maxTokens: Number(v.maxTokens ?? 32768),
				maxConcurrency: Number(v.maxConcurrency ?? 8),
				maxRetries: Number(v.maxRetries ?? 3),
				timeoutMs: Number(v.timeoutMs ?? 3e5),
				cacheMaxEntries: Number(v.cacheMaxEntries ?? 1e4),
				estimatedInputUsdPerMillion: Number(v.estimatedInputUsdPerMillion ?? 0),
				estimatedOutputUsdPerMillion: Number(v.estimatedOutputUsdPerMillion ?? 0)
			};
		}
		function message(error) {
			return error instanceof Error ? error.message : String(error);
		}
		function Label({ title, help }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: { minWidth: 0 },
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						fontSize: 14,
						fontWeight: 400,
						lineHeight: "22px",
						color: "var(--dsw-alias-label-primary)"
					},
					children: title
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						fontSize: 12,
						lineHeight: "18px",
						color: "var(--dsw-alias-label-tertiary)",
						marginTop: 2
					},
					children: help
				})]
			});
		}
		function GroupTitle({ children }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
				style: groupTitle,
				children
			});
		}
		function compact(value) {
			return new Intl.NumberFormat("zh-CN", {
				notation: value >= 1e4 ? "compact" : "standard",
				maximumFractionDigits: value >= 1e3 ? 1 : 0
			}).format(value);
		}
		function money(value) {
			return "$" + value.toLocaleString("en-US", {
				minimumFractionDigits: value < .01 ? 4 : 2,
				maximumFractionDigits: value < .01 ? 4 : 2
			});
		}
		function duration(value) {
			if (value < 1e3) return Math.round(value) + " ms";
			if (value < 6e4) return (value / 1e3).toFixed(1) + " s";
			return (value / 6e4).toFixed(1) + " min";
		}
		function dateTime(value) {
			return new Intl.DateTimeFormat("zh-CN", {
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit"
			}).format(value);
		}
		function startOfRange(days) {
			const date = /* @__PURE__ */ new Date();
			date.setHours(0, 0, 0, 0);
			date.setDate(date.getDate() - days + 1);
			return date.getTime();
		}
		function endOfToday() {
			const date = /* @__PURE__ */ new Date();
			date.setHours(0, 0, 0, 0);
			date.setDate(date.getDate() + 1);
			return date.getTime();
		}
		function VerifierSettings({ api }) {
			const [loaded, setLoaded] = (0, react.useState)(null);
			const [draft, setDraft] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const [saved, setSaved] = (0, react.useState)(false);
			const load = async () => {
				setError(null);
				try {
					const [m, s] = await Promise.all([api.llm.models({}), api.settings.describe({})]);
					if (!m.result.ok) throw new Error(m.result.error.message);
					if (!s.result.ok) throw new Error(s.result.error.message);
					const view = s.result.value.namespaces.find((x) => x.ns === NS);
					if (!view) throw new Error("Verifier settings namespace is not registered. Restart the DSH host.");
					const next = {
						groups: m.result.value.groups,
						settings: view,
						writable: s.result.value.writable,
						failures: m.result.value.failures.map((f) => f.name + ": " + f.message)
					};
					setLoaded(next);
					setDraft(values(view));
				} catch (e) {
					setError(message(e));
				}
			};
			(0, react.useEffect)(() => {
				load();
			}, []);
			const models = (0, react.useMemo)(() => loaded?.groups.find((g) => g.id === draft?.provider)?.models ?? [], [loaded, draft?.provider]);
			const efforts = models.find((m) => m.id === draft?.model)?.reasoning?.efforts ?? [];
			const patch = (key, value) => setDraft((v) => v ? {
				...v,
				[key]: value
			} : v);
			const save = async () => {
				if (!loaded || !draft) return;
				setBusy(true);
				setSaved(false);
				setError(null);
				try {
					const section = {
						...record(loaded.settings.user),
						...draft
					};
					if (!draft.reasoningEffort) delete section.reasoningEffort;
					const res = await api.settings.update({
						ns: NS,
						patch: section,
						expectedRevision: loaded.settings.revision
					});
					if (!res.result.ok) throw new Error(res.result.error.message);
					setLoaded((v) => v ? {
						...v,
						settings: res.result.value
					} : v);
					setDraft(values(res.result.value));
					setSaved(true);
				} catch (e) {
					setError(message(e));
				} finally {
					setBusy(false);
				}
			};
			if (!loaded || !draft) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: shell,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						style: settingsHeading,
						children: "LLM Verifier"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: settingsIntro,
						children: error ?? "正在读取 DSH 模型和设置…"
					}),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "outline",
						onClick: () => void load(),
						children: "重试"
					}) })
				]
			});
			const numeric = (key, min = 0) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
				style: {
					width: "100%",
					height: 36,
					borderRadius: 8
				},
				type: "number",
				min,
				value: String(draft[key]),
				onChange: (e) => patch(key, Number(e.target.value))
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: shell,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						style: settingsHeading,
						children: "LLM Verifier"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: settingsIntro,
						children: "选择已在 DSH「模型」中配置的模型作为独立裁判。修改后点击页面底部的保存按钮生效。"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						style: group,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(GroupTitle, { children: "工具" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: "启用 Verifier 工具",
									help: draft.enabled ? "允许 Agent 调用四个 verifier 工具并向裁判模型发起请求。" : "停用后，所有 verifier 工具都会立即返回错误。"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									role: "switch",
									"aria-checked": draft.enabled,
									"aria-label": "启用 Verifier 工具",
									onClick: () => patch("enabled", !draft.enabled),
									style: toggleStyle(draft.enabled),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: toggleThumbStyle(draft.enabled) })
								})]
							}),
							!draft.enabled && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: {
									margin: "8px 0 0",
									fontSize: 12,
									lineHeight: "18px",
									color: "var(--dsw-alias-state-warn-label)"
								},
								children: "verifier_compare、verifier_select、verifier_track 和 verifier_current_session 当前不可用。"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						style: group,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(GroupTitle, { children: "自动验收" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: "调用策略",
									help: "手动仅暴露工具；智能在复杂且有真实证据的任务结束前验收；严格对任何已完成的写入、执行或远程操作进行验收。"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									style: selectStyle,
									value: draft.autoVerifyMode,
									onChange: (e) => patch("autoVerifyMode", e.target.value),
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "manual",
											children: "手动"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "smart",
											children: "智能（推荐）"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "strict",
											children: "严格"
										})
									]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: "通过阈值",
									help: "会话证据分数达到该值且胜过空工作基线才允许结束；范围 0–1。"
								}), numeric("autoVerifyThreshold", 0)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: "自动评估轮次",
									help: "每项标准的自动评分重复次数；1 为低成本初筛。"
								}), numeric("autoVerifyRepeats", 1)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: "智能模式最少工具调用",
									help: "达到此工具证据数量且包含写入/执行类操作时才自动验收。"
								}), numeric("autoVerifyMinToolCalls", 1)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: "最大证据字符",
									help: "发送给裁判前保留的最近会话证据字符数。"
								}), numeric("autoVerifyMaxChars", 1e3)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: "每任务最多验收",
									help: "低分反馈后允许再次验收的次数上限，防止循环。"
								}), numeric("autoVerifyMaxPerTask", 1)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: "每会话最多验收",
									help: "同一会话中的自动验收总预算。"
								}), numeric("autoVerifyMaxPerSession", 1)]
							}),
							draft.autoVerifyMode !== "manual" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: {
									margin: "8px 0 0",
									fontSize: 12,
									lineHeight: "18px",
									color: "var(--dsw-alias-state-warn-label)"
								},
								children: "自动验收会将脱敏后的任务、Assistant 轨迹与真实工具输出发送给所选裁判模型；未通过时会自动要求 Agent 修复并重新验证。"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						style: group,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(GroupTitle, { children: "裁判模型" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: "供应商",
									help: "当前 DSH 中可路由的模型供应商。"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
									style: selectStyle,
									value: draft.provider,
									onChange: (e) => {
										const provider = e.target.value;
										const first = loaded.groups.find((g) => g.id === provider)?.models[0];
										setDraft({
											...draft,
											provider,
											...first ? {
												model: first.id,
												reasoningEffort: first.reasoning?.defaultEffort
											} : {}
										});
									},
									children: loaded.groups.map((g) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
										value: g.id,
										children: [
											g.name,
											" · ",
											g.id
										]
									}, g.id))
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: "模型",
									help: "用作裁判的具体模型。"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
									style: selectStyle,
									value: draft.model,
									onChange: (e) => {
										const model = e.target.value;
										const found = models.find((m) => m.id === model);
										setDraft({
											...draft,
											model,
											...found?.reasoning?.defaultEffort ? { reasoningEffort: found.reasoning.defaultEffort } : { reasoningEffort: void 0 }
										});
									},
									children: models.map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
										value: m.id,
										children: [
											m.name,
											" · ",
											m.id
										]
									}, m.id))
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: "推理强度",
									help: "留空时使用所选模型的默认值。"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									style: selectStyle,
									value: draft.reasoningEffort ?? "",
									onChange: (e) => patch("reasoningEffort", e.target.value || void 0),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "",
										children: "模型默认"
									}), efforts.map((e) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: e.id,
										children: e.name
									}, e.id))]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: "最大输出 Token",
									help: "单次裁判请求允许生成的最大 Token 数。"
								}), numeric("maxTokens", 1)]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						style: group,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(GroupTitle, { children: "执行" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: "最大并发",
									help: "所有 verifier 工具共享的请求并发上限。"
								}), numeric("maxConcurrency", 1)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: "最多重试",
									help: "限流、超时和短暂网络错误的重试次数。"
								}), numeric("maxRetries", 0)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: "请求超时",
									help: "单次模型请求的超时时间，单位为毫秒。"
								}), numeric("timeoutMs", 1)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: "缓存条目上限",
									help: "本地持久评分缓存保留的最大条目数。"
								}), numeric("cacheMaxEntries", 1)]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						style: group,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(GroupTitle, { children: "费用估算" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: "输入价格",
									help: "每百万输入 Token 的美元价格，仅用于统计估算。"
								}), numeric("estimatedInputUsdPerMillion", 0)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: "输出价格",
									help: "每百万输出 Token 的美元价格，仅用于统计估算。"
								}), numeric("estimatedOutputUsdPerMillion", 0)]
							})
						]
					}),
					loaded.failures.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							padding: "10px 12px",
							borderRadius: 8,
							background: "var(--dsw-alias-state-warn-bg)",
							color: "var(--dsw-alias-state-warn-label)",
							fontSize: 12,
							lineHeight: "18px"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								fontWeight: 500,
								marginBottom: 3
							},
							children: "部分模型目录读取失败"
						}), loaded.failures.map((x) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: x }, x))]
					}),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: {
							margin: 0,
							fontSize: 12,
							lineHeight: "18px",
							color: "var(--dsw-alias-state-error-primary)"
						},
						children: error
					}),
					saved && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: {
							margin: 0,
							fontSize: 12,
							lineHeight: "18px",
							color: "var(--dsw-alias-state-success-primary)"
						},
						children: "设置已保存。"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							justifyContent: "flex-end",
							gap: 8,
							paddingTop: 4
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							disabled: busy,
							onClick: () => void load(),
							children: "重新载入"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "primary",
							disabled: busy || !loaded.writable,
							onClick: () => void save(),
							children: busy ? "保存中…" : "保存设置"
						})]
					})
				]
			});
		}
		function Metric({ label, value, note, accent }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					...dashboardCard,
					padding: "16px 18px",
					minWidth: 0
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: muted,
						children: label
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							fontSize: 25,
							fontWeight: 750,
							lineHeight: 1.2,
							margin: "7px 0 5px",
							color: accent
						},
						children: value
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							...muted,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap"
						},
						children: note
					})
				]
			});
		}
		function TrendChart({ daily, days }) {
			const rows = (0, react.useMemo)(() => {
				const map = new Map(daily.map((row) => [row.date, row]));
				const values = [];
				const start = new Date(startOfRange(days));
				for (let i = 0; i < days; i += 1) {
					const date = new Date(start);
					date.setDate(start.getDate() + i);
					const key = [
						date.getFullYear(),
						String(date.getMonth() + 1).padStart(2, "0"),
						String(date.getDate()).padStart(2, "0")
					].join("-");
					values.push(map.get(key) ?? {
						date: key,
						invocations: 0,
						successes: 0,
						failures: 0,
						calls: 0,
						tokens: 0,
						estimatedCostUsd: 0,
						byTool: {}
					});
				}
				return values;
			}, [daily, days]);
			const width = 760, height = 230, pad = {
				l: 44,
				r: 24,
				t: 20,
				b: 38
			};
			const innerW = width - pad.l - pad.r, innerH = height - pad.t - pad.b;
			const max = Math.max(1, ...rows.flatMap((row) => [row.invocations, row.calls]));
			const x = (index) => pad.l + (rows.length <= 1 ? innerW / 2 : index * innerW / (rows.length - 1));
			const y = (value) => pad.t + innerH - value / max * innerH;
			const points = rows.map((row, index) => `${x(index)},${y(row.calls)}`).join(" ");
			const step = rows.length > 16 ? Math.ceil(rows.length / 7) : Math.max(1, Math.ceil(rows.length / 7));
			const barWidth = Math.max(3, Math.min(18, innerW / Math.max(rows.length, 1) * .55));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					width: "100%",
					overflowX: "auto"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					viewBox: `0 0 ${width} ${height}`,
					style: {
						display: "block",
						width: "100%",
						minWidth: 620,
						height: "auto"
					},
					"aria-label": "每日工具调用与模型请求趋势",
					children: [
						[
							0,
							.25,
							.5,
							.75,
							1
						].map((ratio) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
							x1: pad.l,
							x2: width - pad.r,
							y1: pad.t + innerH * ratio,
							y2: pad.t + innerH * ratio,
							stroke: "rgba(148,163,184,.16)"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("text", {
							x: pad.l - 8,
							y: pad.t + innerH * ratio + 4,
							textAnchor: "end",
							fontSize: "10",
							fill: "var(--dsw-text-secondary)",
							children: Math.round(max * (1 - ratio))
						})] }, ratio)),
						rows.map((row, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
							x: x(index) - barWidth / 2,
							y: y(row.invocations),
							width: barWidth,
							height: pad.t + innerH - y(row.invocations),
							rx: "2",
							fill: "#4f8cff",
							opacity: ".82"
						}, row.date)),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("polyline", {
							points,
							fill: "none",
							stroke: "#5ed7e8",
							strokeWidth: "2.4",
							strokeLinejoin: "round",
							strokeLinecap: "round"
						}),
						rows.map((row, index) => index % step === 0 || index === rows.length - 1 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("text", {
							x: x(index),
							y: height - 14,
							textAnchor: "middle",
							fontSize: "10",
							fill: "var(--dsw-text-secondary)",
							children: [
								Number(row.date.slice(5, 7)),
								"/",
								Number(row.date.slice(8, 10))
							]
						}, row.date) : null)
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						display: "flex",
						justifyContent: "center",
						gap: 18,
						...muted
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: {
						display: "inline-block",
						width: 8,
						height: 8,
						borderRadius: 2,
						background: "#4f8cff",
						marginRight: 6
					} }), "工具调用"] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: {
						display: "inline-block",
						width: 14,
						height: 2,
						background: "#5ed7e8",
						marginRight: 6,
						verticalAlign: "middle"
					} }), "模型请求"] })]
				})]
			});
		}
		function StatisticsPage({ sessionId, rpc }) {
			const [days, setDays] = (0, react.useState)(30);
			const [sessionOnly, setSessionOnly] = (0, react.useState)(false);
			const [data, setData] = (0, react.useState)(null);
			const [loading, setLoading] = (0, react.useState)(true);
			const [error, setError] = (0, react.useState)(null);
			const [refresh, setRefresh] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				setLoading(true);
				setError(null);
				rpc.call("/llm-verifier", "statistics", {
					fromMs: startOfRange(days),
					toMs: endOfToday(),
					timezoneOffsetMinutes: (/* @__PURE__ */ new Date()).getTimezoneOffset(),
					recentLimit: 50,
					...sessionOnly ? { sessionId: String(sessionId) } : {}
				}, controller.signal).then((result) => {
					if (!result.ok) throw new Error(result.error?.message ?? "统计接口请求失败");
					setData(result.value);
				}, (cause) => {
					if (!controller.signal.aborted) throw cause;
				}).catch((cause) => {
					if (!controller.signal.aborted) setError(message(cause));
				}).finally(() => {
					if (!controller.signal.aborted) setLoading(false);
				});
				return () => controller.abort();
			}, [
				days,
				sessionOnly,
				sessionId,
				refresh,
				rpc
			]);
			const totals = data?.totals;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("main", {
				style: {
					height: "100%",
					overflow: "auto",
					boxSizing: "border-box",
					padding: "22px clamp(16px, 3vw, 38px) 48px",
					color: "var(--dsw-text-primary)",
					background: "radial-gradient(circle at 10% 0%, rgba(115,77,255,.09), transparent 32%), radial-gradient(circle at 100% 8%, rgba(47,197,201,.07), transparent 28%)"
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						maxWidth: 1180,
						margin: "0 auto",
						display: "flex",
						flexDirection: "column",
						gap: 16
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
							style: {
								display: "flex",
								justifyContent: "space-between",
								alignItems: "flex-start",
								gap: 16,
								flexWrap: "wrap"
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									alignItems: "center",
									gap: 10
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										display: "grid",
										placeItems: "center",
										width: 34,
										height: 34,
										borderRadius: 10,
										background: "rgba(79,140,255,.14)",
										color: "#6da0ff"
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDataOutline16, { size: 18 })
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
									style: {
										margin: 0,
										fontSize: 23
									},
									children: "Verifier 工具统计"
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								style: {
									margin: "7px 0 0 44px",
									...muted
								},
								children: [
									"数据更新于 ",
									data ? dateTime(data.generatedAt) : "--",
									" · 自动记录四个验证工具的实际执行结果"
								]
							})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									gap: 8,
									alignItems: "center",
									flexWrap: "wrap"
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										style: {
											display: "flex",
											padding: 3,
											borderRadius: 10,
											background: "var(--dsw-surface-sunken)",
											border: "1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.12))"
										},
										children: [
											7,
											30,
											90
										].map((value) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											onClick: () => setDays(value),
											style: {
												border: 0,
												borderRadius: 7,
												padding: "6px 10px",
												cursor: "pointer",
												color: days === value ? "#fff" : "var(--dsw-text-secondary)",
												background: days === value ? "#3f68d8" : "transparent"
											},
											children: [value, " 天"]
										}, value))
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										onClick: () => setSessionOnly((value) => !value),
										style: {
											border: "1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.15))",
											borderRadius: 9,
											padding: "7px 11px",
											cursor: "pointer",
											color: "var(--dsw-text-primary)",
											background: sessionOnly ? "rgba(79,140,255,.18)" : "var(--dsw-surface-sunken)"
										},
										children: sessionOnly ? "当前会话" : "全部会话"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										title: "刷新",
										onClick: () => setRefresh((value) => value + 1),
										style: {
											display: "grid",
											placeItems: "center",
											width: 34,
											height: 34,
											borderRadius: 9,
											border: "1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.15))",
											color: "var(--dsw-text-primary)",
											background: "var(--dsw-surface-sunken)",
											cursor: "pointer"
										},
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline16, { size: 16 })
									})
								]
							})]
						}),
						error && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								...dashboardCard,
								padding: 18,
								borderColor: "var(--dsw-danger, #e85858)",
								color: "var(--dsw-danger, #e85858)"
							},
							children: [error, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									...muted,
									marginTop: 6
								},
								children: "请确认宿主已重启并加载最新版本的 dsh-llm-verifier。"
							})]
						}),
						loading && !data ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								...dashboardCard,
								padding: 32,
								textAlign: "center",
								...muted
							},
							children: "正在读取工具运行统计…"
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								style: {
									...dashboardCard,
									padding: "22px 24px",
									display: "grid",
									gridTemplateColumns: "minmax(220px,1.4fr) minmax(240px,1fr)",
									gap: 24,
									alignItems: "center"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: muted,
										children: [days, " 天估算费用"]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										style: {
											fontSize: 38,
											fontWeight: 780,
											letterSpacing: "-.03em",
											margin: "5px 0"
										},
										children: money(totals?.estimatedCostUsd ?? 0)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: muted,
										children: [
											compact(totals?.invocations ?? 0),
											" 次工具调用 · ",
											compact(totals?.calls ?? 0),
											" 次裁判模型请求"
										]
									})
								] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "grid",
										gridTemplateColumns: "1fr auto",
										gap: "9px 16px",
										fontSize: 13
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: muted,
											children: "成功调用"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", { children: [
											compact(totals?.successes ?? 0),
											" ",
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", {
												style: { color: "#77d49b" },
												children: [
													"▲ ",
													((totals?.successRate ?? 0) * 100).toFixed(1),
													"%"
												]
											})
										] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: muted,
											children: "失败调用"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: compact(totals?.failures ?? 0) }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: muted,
											children: "平均耗时"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: duration(totals?.averageDurationMs ?? 0) })
									]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								style: {
									display: "grid",
									gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
									gap: 12
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Metric, {
										label: "缓存命中率",
										value: ((totals?.cacheHitRate ?? 0) * 100).toFixed(1) + "%",
										note: `${compact(totals?.cacheHits ?? 0)} 命中 / ${compact((totals?.cacheHits ?? 0) + (totals?.cacheMisses ?? 0))} 评分`,
										accent: "#b7dd64"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Metric, {
										label: "Token",
										value: compact(totals?.tokens ?? 0),
										note: `输入 ${compact((totals?.inputTokens ?? 0) + (totals?.cachedInputTokens ?? 0))} · 输出 ${compact(totals?.outputTokens ?? 0)}`
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Metric, {
										label: "平均模型请求",
										value: (totals?.invocations ?? 0) > 0 ? ((totals?.calls ?? 0) / (totals?.invocations ?? 1)).toFixed(1) : "0",
										note: `${compact(totals?.attempts ?? 0)} 次尝试 · ${compact(totals?.retries ?? 0)} 次重试`
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Metric, {
										label: "评分模式",
										value: compact(totals?.topLogprobScores ?? 0),
										note: `Top-logprobs · 显式标签 ${compact(totals?.explicitTagScores ?? 0)}`
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								style: {
									...dashboardCard,
									padding: "18px 20px 16px"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										justifyContent: "space-between",
										alignItems: "center",
										marginBottom: 4
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "每日工具调用与模型请求趋势" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: muted,
										children: sessionOnly ? "当前会话" : "全部会话"
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TrendChart, {
									daily: data?.daily ?? [],
									days
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								style: {
									...dashboardCard,
									padding: "18px 18px 8px",
									overflow: "hidden"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										justifyContent: "space-between",
										margin: "0 2px 12px"
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "工具运行明细" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										style: muted,
										children: [data?.tools.length ?? 0, " 类工具"]
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: { overflowX: "auto" },
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
										style: {
											width: "100%",
											borderCollapse: "collapse",
											fontSize: 13,
											minWidth: 760
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tr", {
											style: {
												textAlign: "left",
												color: "var(--dsw-text-secondary)",
												background: "var(--dsw-surface-sunken)"
											},
											children: [
												"工具",
												"调用",
												"成功率",
												"平均耗时",
												"模型请求",
												"Token",
												"缓存命中",
												"估算费用"
											].map((value) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
												style: {
													padding: "10px 12px",
													fontWeight: 500
												},
												children: value
											}, value))
										}) }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tbody", { children: [(data?.tools ?? []).map((tool) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", {
											style: { borderTop: "1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.1))" },
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("td", {
													style: { padding: "13px 12px" },
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
															display: "inline-block",
															width: 8,
															height: 8,
															borderRadius: "50%",
															background: toolColors[tool.toolName] ?? "#8691a8",
															marginRight: 8
														} }),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: toolLabels[tool.toolName] ?? tool.toolName }),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
															style: {
																...muted,
																margin: "3px 0 0 16px"
															},
															children: tool.toolName
														})
													]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
													style: { padding: "13px 12px" },
													children: compact(tool.invocations)
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("td", {
													style: {
														padding: "13px 12px",
														color: tool.successRate >= .9 ? "#77d49b" : tool.successRate >= .7 ? "#e3bd63" : "#ed7777"
													},
													children: [(tool.successRate * 100).toFixed(1), "%"]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
													style: { padding: "13px 12px" },
													children: duration(tool.averageDurationMs)
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
													style: { padding: "13px 12px" },
													children: compact(tool.calls)
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
													style: { padding: "13px 12px" },
													children: compact(tool.tokens)
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("td", {
													style: { padding: "13px 12px" },
													children: [
														tool.cacheHits,
														"/",
														tool.cacheHits + tool.cacheMisses
													]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
													style: { padding: "13px 12px" },
													children: money(tool.estimatedCostUsd)
												})
											]
										}, tool.toolName)), (data?.tools.length ?? 0) === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tr", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
											colSpan: 8,
											style: {
												padding: 28,
												textAlign: "center",
												...muted
											},
											children: "所选范围内还没有 Verifier 工具调用。后续执行会自动出现在这里。"
										}) })] })]
									})
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								style: {
									display: "grid",
									gridTemplateColumns: "minmax(0,1fr) minmax(290px,.45fr)",
									gap: 16,
									alignItems: "start"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										...dashboardCard,
										padding: "18px 18px 8px",
										overflow: "hidden"
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											display: "flex",
											justifyContent: "space-between",
											margin: "0 2px 12px"
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "最近调用" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: muted,
											children: "最多 50 条"
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											maxHeight: 360,
											overflow: "auto"
										},
										children: [(data?.recent ?? []).map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: {
												display: "grid",
												gridTemplateColumns: "minmax(170px,1fr) auto",
												gap: 12,
												padding: "11px 8px",
												borderTop: "1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.1))"
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												style: {
													display: "flex",
													alignItems: "center",
													gap: 8
												},
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
														width: 7,
														height: 7,
														borderRadius: "50%",
														background: item.success ? "#59c985" : "#e76565"
													} }),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
														style: { fontSize: 13 },
														children: toolLabels[item.toolName] ?? item.toolName
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														style: muted,
														children: [
															item.provider,
															"/",
															item.model
														]
													})
												]
											}), !item.success && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												title: item.errorMessage,
												style: {
													margin: "5px 0 0 15px",
													fontSize: 11,
													color: "#e76565",
													overflow: "hidden",
													textOverflow: "ellipsis",
													whiteSpace: "nowrap"
												},
												children: item.errorMessage ?? item.errorName
											})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												style: { textAlign: "right" },
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
													style: { fontSize: 12 },
													children: duration(item.durationMs)
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
													style: {
														...muted,
														marginTop: 3
													},
													children: dateTime(item.startedAt)
												})]
											})]
										}, item.id)), (data?.recent.length ?? 0) === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											style: {
												padding: 24,
												textAlign: "center",
												...muted
											},
											children: "暂无记录"
										})]
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										...dashboardCard,
										padding: "18px"
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "模型汇总" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											marginTop: 10,
											display: "flex",
											flexDirection: "column",
											gap: 10
										},
										children: [(data?.models ?? []).map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: {
												padding: "11px 12px",
												borderRadius: 10,
												background: "var(--dsw-surface-sunken)"
											},
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
													style: {
														fontWeight: 650,
														fontSize: 13,
														overflow: "hidden",
														textOverflow: "ellipsis"
													},
													children: model.model
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
													style: {
														...muted,
														marginTop: 3
													},
													children: model.provider
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													style: {
														display: "flex",
														justifyContent: "space-between",
														marginTop: 9,
														fontSize: 12
													},
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [compact(model.calls), " 请求"] }),
														/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [compact(model.tokens), " Token"] }),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: money(model.estimatedCostUsd) })
													]
												})
											]
										}, model.provider + "\0" + model.model)), (data?.models.length ?? 0) === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											style: muted,
											children: "暂无模型调用"
										})]
									})]
								})]
							})
						] })
					]
				})
			});
		}
		const inject = ["slots", "connection"];
		function apply(ctx) {
			const connection = ctx.get("connection");
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "llm-verifier",
				order: 35,
				label: "LLM Verifier",
				inject: () => ({ api: connection.api })
			}, VerifierSettings));
			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "llm-verifier-statistics",
				order: 30,
				label: "工具统计",
				inject: () => ({ rpc: connection.rpc })
			}, StatisticsPage));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map