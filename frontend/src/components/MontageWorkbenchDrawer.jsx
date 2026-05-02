import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { X, Clapperboard, ChevronUp, ChevronDown, Trash2, Loader2, Save } from "lucide-react";

const API = axios.create({ baseURL: "/api" });

export default function MontageWorkbenchDrawer({ open, onClose }) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [orderedIds, setOrderedIds] = useState([]);
  const [bgmPath, setBgmPath] = useState("");
  const [introPath, setIntroPath] = useState("");
  const [outroPath, setOutroPath] = useState("");
  const [outputFilename, setOutputFilename] = useState("montage_export.mp4");
  const [outputDir, setOutputDir] = useState("");
  const [exporting, setExporting] = useState(false);
  const [lastExport, setLastExport] = useState(null);
  const [projectId, setProjectId] = useState(null);
  const [draftName, setDraftName] = useState("");

  const loadClips = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await API.get("/recorded-clips", { params: { limit: 500, offset: 0 } });
      setItems(data.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadClips();
  }, [open, loadClips]);

  const byId = useMemo(() => {
    const m = new Map();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);

  const addToSequence = useCallback(
    (id) => {
      setOrderedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    },
    [],
  );

  const removeFromSequence = useCallback((id) => {
    setOrderedIds((prev) => prev.filter((x) => x !== id));
  }, []);

  const move = useCallback((id, dir) => {
    setOrderedIds((prev) => {
      const i = prev.indexOf(id);
      if (i < 0) return prev;
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }, []);

  const totalDuration = useMemo(() => {
    let s = 0;
    for (const id of orderedIds) {
      const it = byId.get(id);
      if (it && typeof it.duration_sec === "number" && Number.isFinite(it.duration_sec)) {
        s += it.duration_sec;
      }
    }
    return s;
  }, [orderedIds, byId]);

  const saveDraft = useCallback(async () => {
    try {
      const { data } = await API.post("/montage/projects", {
        project_id: projectId,
        name: draftName || "合辑草稿",
        recorded_clip_ids: orderedIds,
        bgm_path: bgmPath.trim() || null,
        intro_path: introPath.trim() || null,
        outro_path: outroPath.trim() || null,
        output_filename: outputFilename.trim() || "montage_export.mp4",
      });
      setProjectId(data.id);
    } catch (e) {
      window.alert(e.response?.data?.detail || e.message);
    }
  }, [projectId, draftName, orderedIds, bgmPath, introPath, outroPath, outputFilename]);

  const runExport = useCallback(async () => {
    const dir = outputDir.trim();
    const fn = (outputFilename.trim() || "montage_export.mp4").replace(/^[/\\]+/, "");
    if (!dir) {
      window.alert("请填写输出目录的绝对路径（例如 C:\\\\Videos\\\\Exports）。");
      return;
    }
    const sep = dir.includes("\\") ? "\\" : "/";
    const outPath = dir.replace(/[/\\]+$/, "") + sep + fn;
    setExporting(true);
    setLastExport(null);
    try {
      const { data } = await API.post("/montage/export", {
        project_id: projectId,
        recorded_clip_ids: orderedIds.length ? orderedIds : undefined,
        bgm_path: bgmPath.trim() || null,
        intro_path: introPath.trim() || null,
        outro_path: outroPath.trim() || null,
        output_path: outPath,
      });
      setLastExport({ ok: true, ...data });
    } catch (e) {
      setLastExport({ ok: false, err: e.response?.data?.detail || e.message });
    } finally {
      setExporting(false);
    }
  }, [projectId, orderedIds, bgmPath, introPath, outroPath, outputDir, outputFilename]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[110] flex justify-end bg-black/55 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="montage-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full w-full max-w-lg flex-col border-l border-white/10 bg-cs2-bg-card shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <Clapperboard className="h-4 w-4 text-cs2-orange" />
            <h2 id="montage-title" className="text-sm font-bold text-white">
              合辑工作台
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-300"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">已录片段</p>
            {loading ? (
              <div className="flex items-center gap-2 py-6 text-xs text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                加载中…
              </div>
            ) : items.length === 0 ? (
              <p className="rounded border border-white/10 bg-black/30 px-2 py-3 text-[11px] text-zinc-500">
                暂无入库片段。完成 OBS 录制成功后会自动出现在此列表。
              </p>
            ) : (
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded border border-white/10 bg-black/30 p-2">
                {items.map((it) => (
                  <li
                    key={it.id}
                    className="flex items-center gap-2 rounded px-1 py-1 text-[10px] text-zinc-300 hover:bg-white/[0.04]"
                  >
                    <button
                      type="button"
                      onClick={() => addToSequence(it.id)}
                      className="shrink-0 rounded border border-cs2-orange/40 px-1.5 py-0.5 font-semibold text-cs2-orange hover:bg-cs2-orange/10"
                    >
                      加入
                    </button>
                    <span className="min-w-0 flex-1 truncate font-mono text-zinc-400" title={it.output_path}>
                      {it.output_path?.split(/[/\\]/).pop() || it.clip_id}
                    </span>
                    {typeof it.duration_sec === "number" ? (
                      <span className="shrink-0 text-zinc-600">{it.duration_sec.toFixed(1)}s</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              合辑顺序（先片头 → 片段 → 片尾）
            </p>
            <p className="mb-2 text-[10px] text-zinc-600">预估总时长（仅已填时长字段的片段）：{totalDuration.toFixed(1)} 秒</p>
            {orderedIds.length === 0 ? (
              <p className="text-[11px] text-zinc-500">从上方列表点「加入」构建顺序。</p>
            ) : (
              <ul className="space-y-1 rounded border border-white/10 bg-black/30 p-2">
                {orderedIds.map((id) => {
                  const it = byId.get(id);
                  const label = it?.output_path?.split(/[/\\]/).pop() || `#${id}`;
                  return (
                    <li
                      key={id}
                      className="flex items-center gap-1 rounded border border-white/[0.06] bg-black/40 px-2 py-1.5 text-[10px]"
                    >
                      <span className="min-w-0 flex-1 truncate font-mono text-zinc-300" title={it?.output_path}>
                        {label}
                      </span>
                      <button
                        type="button"
                        className="rounded p-0.5 text-zinc-500 hover:text-white"
                        onClick={() => move(id, -1)}
                        aria-label="上移"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="rounded p-0.5 text-zinc-500 hover:text-white"
                        onClick={() => move(id, 1)}
                        aria-label="下移"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="rounded p-0.5 text-zinc-500 hover:text-red-400"
                        onClick={() => removeFromSequence(id)}
                        aria-label="移除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <label className="block text-[10px] text-zinc-500">
              草稿名称（可选）
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-[11px] text-zinc-200"
                placeholder="例如 2026-05-01 高光"
              />
            </label>
            <label className="block text-[10px] text-zinc-500">
              BGM 文件绝对路径（可选）
              <input
                value={bgmPath}
                onChange={(e) => setBgmPath(e.target.value)}
                className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-[10px] text-zinc-200"
              />
            </label>
            <label className="block text-[10px] text-zinc-500">
              片头视频绝对路径（可选）
              <input
                value={introPath}
                onChange={(e) => setIntroPath(e.target.value)}
                className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-[10px] text-zinc-200"
              />
            </label>
            <label className="block text-[10px] text-zinc-500">
              片尾视频绝对路径（可选）
              <input
                value={outroPath}
                onChange={(e) => setOutroPath(e.target.value)}
                className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-[10px] text-zinc-200"
              />
            </label>
            <label className="block text-[10px] text-zinc-500">
              输出文件名
              <input
                value={outputFilename}
                onChange={(e) => setOutputFilename(e.target.value)}
                className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-[10px] text-zinc-200"
              />
            </label>
            <label className="block text-[10px] text-zinc-500">
              输出目录（绝对路径，不含文件名）
              <input
                value={outputDir}
                onChange={(e) => setOutputDir(e.target.value)}
                className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-[10px] text-zinc-200"
                placeholder="C:\Videos\Exports"
              />
            </label>
          </div>

          {lastExport && (
            <div
              className={`rounded border px-2 py-2 text-[11px] ${
                lastExport.ok ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-200" : "border-red-500/40 bg-red-950/30 text-red-200"
              }`}
            >
              {lastExport.ok ? (
                <span>
                  导出完成。输出文件：
                  <span className="mt-1 block break-all font-mono text-[10px]">{lastExport.output_path}</span>
                </span>
              ) : (
                <span>导出失败：{String(lastExport.err)}</span>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-white/10 bg-black/30 px-4 py-3">
          <button
            type="button"
            onClick={() => void saveDraft()}
            className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-[11px] font-semibold text-zinc-200 hover:border-cs2-orange/40"
          >
            <Save className="h-3.5 w-3.5" />
            保存草稿
          </button>
          <button
            type="button"
            disabled={exporting || orderedIds.length === 0}
            onClick={() => void runExport()}
            className="inline-flex items-center gap-1 rounded-lg border border-cs2-orange/50 bg-cs2-orange/15 px-3 py-2 text-[11px] font-bold text-cs2-orange hover:bg-cs2-orange/25 disabled:opacity-40"
          >
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clapperboard className="h-3.5 w-3.5" />}
            导出合辑
          </button>
        </div>
      </div>
    </div>
  );
}
