window.__ModuleLoader__.load({
	id: "@local/dsh-llm-verifier",
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
			display: "flex",
			flexDirection: "column",
			gap: 18,
			padding: "8px 4px 32px",
			color: "var(--dsw-text-primary)"
		};
		const card = {
			display: "flex",
			flexDirection: "column",
			gap: 0,
			padding: "16px 16px 0",
			border: "1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.16))",
			borderRadius: 12,
			background: "var(--dsw-alias-bg-module, rgba(20, 31, 57, 0.42))",
			overflow: "hidden"
		};
		const sectionTitle = {
			display: "flex",
			gap: 10,
			alignItems: "center",
			padding: "0 0 12px",
			borderBottom: "1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.16))"
		};
		const row = {
			display: "grid",
			gridTemplateColumns: "minmax(150px, 1fr) minmax(220px, 1.4fr)",
			gap: 18,
			alignItems: "center",
			padding: "14px 0",
			borderBottom: "1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.16))"
		};
		const selectStyle = {
			width: "100%",
			minHeight: 38,
			padding: "0 12px",
			borderRadius: 10,
			color: "var(--dsw-text-primary)",
			background: "var(--dsw-surface-sunken)",
			border: "1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.16))"
		};
		function record(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
		}
		function values(view) {
			const v = record(view.value);
			return {
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
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: { fontWeight: 600 },
				children: title
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					fontSize: 12,
					color: "var(--dsw-text-secondary)",
					marginTop: 3
				},
				children: help
			})] });
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: "LLM Verifier" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: error ?? "正在读取 DSH 模型和设置…" }),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						onClick: () => void load(),
						children: "重试"
					})
				]
			});
			const numeric = (key, min = 0) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
				type: "number",
				min,
				value: String(draft[key]),
				onChange: (e) => patch(key, Number(e.target.value))
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: shell,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						style: { margin: "0 0 6px" },
						children: "LLM Verifier"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: {
							margin: 0,
							color: "var(--dsw-text-secondary)"
						},
						children: "选择任意已在 DSH「模型」页配置并启用的模型作为独立裁判。设置实时生效。"
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: card,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: sectionTitle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "done" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "裁判模型" })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: "供应商",
									help: "只显示当前 DSH 中可路由的供应商"
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
									help: "模型目录来自 DSH adapter，选择结果会持久化"
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
									help: "由所选模型 adapter 声明；留空使用模型默认值"
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
									help: "每个裁判请求的输出上限"
								}), numeric("maxTokens", 1)]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: card,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: sectionTitle,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "执行控制" })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: "最大并发",
									help: "所有 verifier 工具共享的请求并发上限"
								}), numeric("maxConcurrency", 1)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: "最多重试",
									help: "短暂网络、限流和服务端错误的重试次数"
								}), numeric("maxRetries", 0)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: "请求超时（毫秒）",
									help: "单个模型请求的超时时间"
								}), numeric("timeoutMs", 1)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: "缓存条目上限",
									help: "持久评分缓存保留的最大条目数"
								}), numeric("cacheMaxEntries", 1)]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: card,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: sectionTitle,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "费用估算（每百万 Token，USD）" })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: "输入价格",
									help: "仅用于结果中的 estimatedCostUsd"
								}), numeric("estimatedInputUsdPerMillion", 0)]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Label, {
									title: "输出价格",
									help: "仅用于结果中的 estimatedCostUsd"
								}), numeric("estimatedOutputUsdPerMillion", 0)]
							})
						]
					}),
					loaded.failures.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							...card,
							borderColor: "var(--dsw-alias-state-warn-primary, #d9a441)",
							paddingBottom: 16
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "部分模型目录读取失败" }), loaded.failures.map((x) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: x }, x))]
					}),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: { color: "var(--dsw-danger)" },
						children: error
					}),
					saved && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: { color: "var(--dsw-success)" },
						children: "已保存，后续 verifier 调用将使用新设置。"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							gap: 10
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							disabled: busy || !loaded.writable,
							onClick: () => void save(),
							children: busy ? "保存中…" : "保存设置"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							disabled: busy,
							onClick: () => void load(),
							children: "重新载入"
						})]
					})
				]
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
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map