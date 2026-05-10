import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import axios from "axios";
import Sidebar from "./components/Sidebar";
import RecordWarmupModal from "./components/RecordWarmupModal";
import ProgressBar from "./components/ProgressBar";
import LibraryLoadModeModal from "./components/LibraryLoadModeModal";
import RecordingQueueDrawer from "./components/RecordingQueueDrawer";
import CommonParamsModal from "./components/CommonParamsModal";
import { useRecordingQueue, stripGlobalPacingMetaKeys } from "./stores/recordingQueueStore";
import { stripClientClipUid } from "./utils/clipClientUid";
import { warmupApiPayloadToPersisted } from "./utils/warmupDefaults";
import MatchCard, { MatchListRow } from "./components/MatchCard";
import IngestModal from "./components/IngestModal";
import DemoInfoModal from "./components/DemoInfoModal";
import {
  Database,
  History,
  RotateCcw,
  Video,
  RotateCw,
  ChevronLeft,
  ChevronRight,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  FolderOpen,
  X,
  PlusCircle,
  Loader2,
  Trash2,
  LayoutGrid,
  List,
} from "lucide-react";

const API = axios.create({ baseURL: "/api" });

/** Demo 库地图筛选下拉项（顺序固定）。 */
const DEMO_LIBRARY_MAP_OPTIONS = [
  "de_dust2",
  "de_mirage",
  "de_inferno",
  "de_ancient",
  "de_nuke",
  "de_anubis",
  "de_overpass",
  "de_train",
  "de_cache",
  "de_vertigo",
];

const DEMO_LIBRARY_STATUS_FILTER_OPTIONS = [
  { value: "loaded", label: "待解析" },
  { value: "done", label: "已完成" },
  { value: "error", label: "解析失败" },
];

const DEMO_LIBRARY_STATUS_LABELS = {
  pending: "待入库",
  loaded: "待解析",
  done: "已完成",
  parsed: "已完成",
  error: "解析失败",
};

function demoLibraryStatusLabel(code) {
  if (code == null || code === "") return "—";
  const key = String(code).trim().toLowerCase();
  return DEMO_LIBRARY_STATUS_LABELS[key] ?? String(code);
}

/**
 * 推断对话框副标题：根据后端返回的 detail 文本判定具体阻断场景。
 * 与原 "CS2 正在运行" 路径共用同一个对话框组件，保持视觉风格统一。
 */
function recordingBlockedSubtitle(message) {
  const m = String(message || "");
  if (
    m.includes("分辨率") ||
    m.includes("屏幕比例") ||
    m.includes("宽高") ||
    m.includes("启动分辨率") ||
    m.includes("所选屏幕比例") ||
    m.includes("填写启动分辨率")
  ) {
    return "录制预热选项未通过校验";
  }
  if (m.includes("GSI") || m.includes("未就绪") || m.includes("未进入游戏")) {
    return "CS2 未在限定时间内进入游戏画面";
  }
  if (m.includes("正在运行") || m.includes("CS2") && m.includes("退出")) {
    return "当前检测到 CS2 正在运行";
  }
  if (m.includes("已有录制任务")) {
    return "已有录制任务进行中";
  }
  if (m.includes("尚未恢复") || m.includes("异常退出") || m.includes("一键恢复")) {
    return "玩家配置需要先恢复";
  }
  return "录制启动条件未满足";
}

/** 提取 FastAPI / axios 报错文案（含 422 校验数组）。 */
function formatRecordingApiError(e) {
  const data = e?.response?.data;
  const d = data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    return d
      .map((item) => {
        if (item && typeof item === "object" && item.msg != null) return String(item.msg);
        try {
          return JSON.stringify(item);
        } catch {
          return String(item);
        }
      })
      .join(" ");
  }
  if (d != null && typeof d === "object") {
    if (typeof d.message === "string") return d.message;
    try {
      return JSON.stringify(d);
    } catch {
      /* fallthrough */
    }
  }
  return String(e?.message || "请求失败");
}

function RecordingBlockedDialog({ message, onClose }) {
  if (!message) return null;
  const subtitle = recordingBlockedSubtitle(message);
  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recording-blocked-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-xl border border-white/10 bg-cs2-bg-card shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-md p-1.5 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-300"
          aria-label="关闭"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-start gap-3 border-b border-white/10 px-5 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cs2-orange/30 bg-cs2-orange/10 text-cs2-orange">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div className="min-w-0 pr-7">
            <h2 id="recording-blocked-title" className="text-sm font-bold text-white">
              无法开始录制
            </h2>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{subtitle}</p>
          </div>
        </div>

        <div className="px-5 py-4">
          <p className="text-sm leading-6 text-zinc-300 whitespace-pre-wrap break-words">{message}</p>
        </div>

        <div className="flex justify-end border-t border-white/10 bg-black/20 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-cs2-orange px-4 py-2 text-sm font-extrabold text-black shadow-lg shadow-cs2-orange/20 transition-colors hover:bg-cs2-orange-light"
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}

function queueItemClientUid(it) {
  return it.clientClipUid || `legacy:${it.demoFilename}:${it.clipId}`;
}

/** @param {number} limit @param {T[]} items @param {(item: T) => Promise<void>} work @template T */
async function runWithConcurrency(limit, items, work) {
  if (!items.length) return;
  const n = Math.min(Math.max(1, limit), items.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const my = cursor++;
      if (my >= items.length) break;
      await work(items[my]);
    }
  };
  await Promise.all(Array.from({ length: n }, () => worker()));
}

/**
 * 构建批量录制 groups 数组。
 * @param {import("./stores/recordingQueueStore").RecordingQueueItem[]} queue
 * @param {import("./stores/recordingQueueStore").PacingOverride} globalPacing
 *   全局节奏参数，作为所有片段的基底；片段自身的 pacing_override 优先级更高（覆盖同名字段）。
 */
function buildBatchGroupsFromQueue(queue, globalPacing = {}) {
  const byDemoPlayer = new Map();
  for (const it of queue) {
    const demoIdentity = it.demoPath || it.demoFilename;
    const key = `${demoIdentity}::${it.targetPlayer || ""}`;
    if (!byDemoPlayer.has(key)) {
      byDemoPlayer.set(key, {
        demo_filename: it.demoFilename,
        demo_path: it.demoPath || null,
        clips: [],
        target_player: it.targetPlayer || null,
        target_player_user_id: it.targetPlayerUserId ?? null,
        target_steam_id: it.targetSteamId || null,
      });
    }
    const clip = { ...stripClientClipUid(it.clipData) };
    const baseGlobal = stripGlobalPacingMetaKeys(globalPacing);
    const mergedPacing = {
      ...( Object.keys(baseGlobal).length ? baseGlobal : {} ),
      ...( it.pacing_override && typeof it.pacing_override === "object" ? it.pacing_override : {} ),
    };
    if (Object.keys(mergedPacing).length) {
      clip.pacing_override = mergedPacing;
    }
    if (clip.fixed_segment_pacing && clip.pacing_override && typeof clip.pacing_override === "object") {
      const deny = new Set([
        "pre_first_sec",
        "post_last_sec",
        "max_gap_sec",
        "post_mid_sec",
        "pre_cont_sec",
      ]);
      const po = { ...clip.pacing_override };
      for (const k of deny) delete po[k];
      if (Object.keys(po).length) clip.pacing_override = po;
      else delete clip.pacing_override;
    }
    byDemoPlayer.get(key).clips.push(clip);
  }
  return Array.from(byDemoPlayer.values());
}

export default function App() {
  const [aiMode, setAiMode] = useState(false);
  const [obsConfig, setObsConfig] = useState({ host: "localhost", port: 4455, password: "" });
  const [obsHasSavedPassword, setObsHasSavedPassword] = useState(false);
  const [obsPasswordEditing, setObsPasswordEditing] = useState(false);
  const obsConfigRef = useRef(obsConfig);
  obsConfigRef.current = obsConfig;
  const obsConfigHydratedRef = useRef(false);
  const pacingPersistReadyRef = useRef(false);
  const [llmConfig, setLlmConfig] = useState({
    provider: "deepseek",
    model: "deepseek-chat",
    api_key: "",
    base_url: "",
  });

  const [parsing, setParsing] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [batchRecording, setBatchRecording] = useState(false);
  const [recordingBlockedMessage, setRecordingBlockedMessage] = useState("");
  const [recordWarmupOpen, setRecordWarmupOpen] = useState(false);
  const [warmupIntent, setWarmupIntent] = useState(null);
  const [configBackupStatus, setConfigBackupStatus] = useState(null);
  const [savedRecordWarmupDefaults, setSavedRecordWarmupDefaults] = useState(null);
  const [queueDrawerOpen, setQueueDrawerOpen] = useState(false);
  const [commonParamsOpen, setCommonParamsOpen] = useState(false);
  const [cs2Path, setCs2Path] = useState("");
  const [cs2FpsMax, setCs2FpsMax] = useState(240);
  const [demoWatchPaths, setDemoWatchPaths] = useState([]);
  const [expectedParsePlayersText, setExpectedParsePlayersText] = useState("");
  const [demoLibraryItems, setDemoLibraryItems] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryLoadingOverlay, setLibraryLoadingOverlay] = useState(false);
  const [libraryLoadingText, setLibraryLoadingText] = useState("正在加载 Demo...");
  const [libraryPage, setLibraryPage] = useState(1);
  const libraryPageRef = useRef(1);
  const [libraryHasNextPage, setLibraryHasNextPage] = useState(false);
  const [libraryTotal, setLibraryTotal] = useState(null);
  const [selectedLibraryDemoIds, setSelectedLibraryDemoIds] = useState(new Set());
  const [libraryRename, setLibraryRename] = useState(null);
  const [libraryDeletePrompt, setLibraryDeletePrompt] = useState(null);
  const [librarySearchInput, setLibrarySearchInput] = useState("");
  const [librarySearchQ, setLibrarySearchQ] = useState("");
  const [libraryAdvFilters, setLibraryAdvFilters] = useState({
    mapName: "",
    status: "all",
    playerQuery: "",
    minKills: "",
    maxDeaths: "",
    minAssists: "",
    minKd: "",
  });
  const [libraryViewMode, setLibraryViewMode] = useState("grid"); // "grid" | "list"
  const [ingestModalOpen, setIngestModalOpen] = useState(false);
  const [libraryJumpDraft, setLibraryJumpDraft] = useState("");
  const [libraryBatchModalOpen, setLibraryBatchModalOpen] = useState(false);
  const [demoInfoModalOpen, setDemoInfoModalOpen] = useState(false);
  const [demoInfoModalDemoId, setDemoInfoModalDemoId] = useState(null);
  const [llmKeySavedOnServer, setLlmKeySavedOnServer] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const llmConfigRef = useRef(llmConfig);
  llmConfigRef.current = llmConfig;

  const refreshConfigBackupStatus = useCallback(async () => {
    try {
      const { data } = await API.get("/config-backup/status");
      setConfigBackupStatus(data);
    } catch {
      setConfigBackupStatus(null);
    }
  }, []);

  const queue           = useRecordingQueue((s) => s.queue);
  const addToQueue      = useRecordingQueue((s) => s.addToQueue);
  const removeFromQueue = useRecordingQueue((s) => s.removeFromQueue);
  const clearQueue      = useRecordingQueue((s) => s.clearQueue);
  const globalPacing    = useRecordingQueue((s) => s.globalPacing);

  const expectedPreviewLines = useMemo(
    () =>
      expectedParsePlayersText
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
    [expectedParsePlayersText]
  );

  const anyDemoParsing = useMemo(() => parsing, [parsing]);

  const queuedClientClipUidsGlobal = useMemo(
    () => new Set(queue.map((q) => queueItemClientUid(q))),
    [queue]
  );

  const LIBRARY_PAGE_SIZE = libraryViewMode === "list" ? 15 : 12;
  const libraryTotalPages =
    libraryTotal == null ? null : Math.max(1, Math.ceil(libraryTotal / LIBRARY_PAGE_SIZE));

  const libraryAdvFiltersKey = useMemo(() => JSON.stringify(libraryAdvFilters), [libraryAdvFilters]);

  useEffect(() => {
    setLibraryPage(1);
  }, [libraryAdvFiltersKey, libraryViewMode]);

  useEffect(() => {
    const t = setTimeout(() => {
      const next = librarySearchInput.trim();
      setLibrarySearchQ((prev) => {
        if (prev === next) return prev;
        setLibraryPage(1);
        return next;
      });
    }, 320);
    return () => clearTimeout(t);
  }, [librarySearchInput]);

  const appendDemoLibraryFilterParams = useCallback((params) => {
    const f = libraryAdvFilters;
    if (f.mapName.trim()) params.map_name = f.mapName.trim();
    if (f.status && f.status !== "all") params.status = f.status;
    const pq = f.playerQuery.trim();
    if (!pq) return;
    params.player_query = pq;
    const num = (v) => {
      const s = String(v ?? "").trim();
      if (!s) return null;
      const n = parseInt(s, 10);
      return Number.isFinite(n) ? n : null;
    };
    const fl = (v) => {
      const s = String(v ?? "").trim();
      if (!s) return null;
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : null;
    };
    const mk = num(f.minKills);
    if (mk != null) params.min_kills = mk;
    const xdth = num(f.maxDeaths);
    if (xdth != null) params.max_deaths = xdth;
    const ma = num(f.minAssists);
    if (ma != null) params.min_assists = ma;
    const mkd = fl(f.minKd);
    if (mkd != null) params.min_kd = mkd;
  }, [libraryAdvFilters]);

  const refreshDemoLibrary = useCallback(async (page = libraryPage, opts = {}) => {
    const { manageLoading = true } = opts;
    if (manageLoading) setLibraryLoading(true);
    try {
      const limit = LIBRARY_PAGE_SIZE;
      const offset = (page - 1) * limit;
      const params = { limit, offset };
      if (librarySearchQ) params.q = librarySearchQ;
      appendDemoLibraryFilterParams(params);
      const { data } = await API.get("/demos", { params });
      setDemoLibraryItems(data.items || []);
      const total = typeof data.total === "number" ? data.total : null;
      if (total != null) {
        setLibraryTotal(total);
        setLibraryHasNextPage(offset + (data.items || []).length < total);
      } else {
        setLibraryTotal(null);
        setLibraryHasNextPage((data.items || []).length === limit);
      }
    } catch {
      // ignore
    } finally {
      if (manageLoading) setLibraryLoading(false);
    }
  }, [libraryPage, librarySearchQ, appendDemoLibraryFilterParams, LIBRARY_PAGE_SIZE]);

  useEffect(() => {
    libraryPageRef.current = libraryPage;
  }, [libraryPage]);

  useEffect(() => {
    let cancelled = false;
    let es = null;
    let debounce = null;
    const scheduleRefresh = () => {
      if (cancelled) return;
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        void refreshDemoLibrary(libraryPageRef.current, { manageLoading: false });
      }, 600);
    };
    const connect = () => {
      if (cancelled) return;
      try {
        es = new EventSource("/api/demos/stream");
      } catch {
        return;
      }
      es.addEventListener("library", scheduleRefresh);
      es.onerror = () => {
        if (cancelled) return;
        try {
          es?.close();
        } catch {
          /* ignore */
        }
        es = null;
        if (!cancelled) window.setTimeout(connect, 4000);
      };
    };
    connect();
    return () => {
      cancelled = true;
      window.clearTimeout(debounce);
      try {
        es?.close();
      } catch {
        /* ignore */
      }
    };
  }, [refreshDemoLibrary]);

  const handleLibraryPageJump = useCallback(() => {
    const raw = libraryJumpDraft.trim();
    if (!raw) return;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) {
      setProgressText("请输入有效页码（≥1 的整数）");
      return;
    }
    const maxPage = libraryTotalPages;
    let target = n;
    if (maxPage != null && n > maxPage) {
      target = maxPage;
      setProgressText(`页码超过总页数，已跳转到最后一页（第 ${maxPage} 页）`);
    }
    setLibraryJumpDraft("");
    setLibraryPage(target);
    void refreshDemoLibrary(target, { manageLoading: false });
  }, [libraryJumpDraft, libraryTotalPages, refreshDemoLibrary]);

  const handleScanDemos = useCallback(async () => {
    setLibraryLoadingOverlay(true);
    setLibraryLoadingText("正在扫描 Demo...");
    setProgressText("正在扫描监听目录并补全全部缺失的玩家统计索引…");
    try {
      const { data } = await API.post("/demos/scan");
      setLibraryLoadingText("扫描完成，正在刷新列表...");
      await refreshDemoLibrary(libraryPage, { manageLoading: false });
      const idx = data?.player_stats_index;
      if (idx && idx.processed > 0) {
        setProgressText(
          `已更新 Demo 库。玩家统计索引：处理 ${idx.processed}，成功 ${idx.indexed}。`
        );
      } else {
        setProgressText("已更新 Demo 库。");
      }
    } catch (e) {
      setProgressText(`扫描或列表刷新失败: ${e.response?.data?.detail || e.message}`);
    } finally {
      setLibraryLoadingOverlay(false);
    }
  }, [refreshDemoLibrary, libraryPage]);

  const handleReparseDemo = useCallback(async (id) => {
    try {
      await API.post(`/demos/${id}/parse`);
      setLibraryAdvFilters((prev) => ({ ...prev, status: "all" }));
      await refreshDemoLibrary(libraryPage, { manageLoading: false });
    } catch (e) {
      setProgressText(`重解析失败: ${e.response?.data?.detail || e.message}`);
    }
  }, [refreshDemoLibrary, libraryPage]);

  const handleDeleteDemo = useCallback(
    async (id, rescan) => {
      try {
        await API.delete(`/demos/${id}`, { params: { rescan } });
        setLibraryDeletePrompt(null);
        await refreshDemoLibrary(libraryPage, { manageLoading: false });
      } catch (e) {
        setProgressText(`删除失败: ${e.response?.data?.detail || e.message}`);
      }
    },
    [refreshDemoLibrary, libraryPage]
  );

  const handleSaveLibraryRename = useCallback(async () => {
    if (!libraryRename) return;
    try {
      await API.patch(`/demos/${libraryRename.id}`, { display_name: libraryRename.draft });
      setLibraryRename(null);
      await refreshDemoLibrary(libraryPage, { manageLoading: false });
    } catch (e) {
      setProgressText(`改名失败: ${e.response?.data?.detail || e.message}`);
    }
  }, [libraryRename, refreshDemoLibrary, libraryPage]);

  const handleUpdateRemark = useCallback(async (id, remark) => {
    try {
      await API.patch(`/demos/${id}/remark`, { remark });
      await refreshDemoLibrary(libraryPage, { manageLoading: false });
    } catch (e) {
      setProgressText(`更新备注失败: ${e.response?.data?.detail || e.message}`);
    }
  }, [refreshDemoLibrary, libraryPage]);

  const handlePlayDemo = useCallback(async (id) => {
    try {
      await API.post(`/demos/${id}/play`);
    } catch (e) {
      setProgressText(`启动播放失败: ${e.response?.data?.detail || e.message}`);
    }
  }, []);

  const handleOpenDemoFile = useCallback(async (id) => {
    try {
      await API.post(`/demos/${id}/open-file`);
    } catch (e) {
      setProgressText(`打开文件位置失败: ${e.response?.data?.detail || e.message}`);
    }
  }, []);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(null);
  const handleDeleteFromCard = useCallback(
    async (id, rescan, deleteFile) => {
      try {
        await API.delete(`/demos/${id}`, { params: { rescan, delete_file: deleteFile } });
        setDeleteConfirmOpen(false);
        await refreshDemoLibrary(libraryPage, { manageLoading: false });
      } catch (e) {
        setProgressText(`删除失败: ${e.response?.data?.detail || e.message}`);
      }
    },
    [refreshDemoLibrary, libraryPage]
  );

  const handleBatchIngest = useCallback(async (ids) => {
    if (!ids || ids.length === 0) return;
    setLibraryLoadingOverlay(true);
    setLibraryLoadingText(`正在入库 ${ids.length} 个 Demo...`);
    try {
      const { data } = await API.post("/demos/batch-ingest", { demo_ids: ids });
      const ingested = data.ingested ?? 0;
      const failed = data.failed ?? [];
      
      setLibraryLoadingText("入库完成，正在刷新列表...");
      
      if (failed.length > 0 && failed.length === ids.length) {
        setProgressText(`入库失败：${failed.map((f) => f.error).join("；")}`);
      } else if (failed.length > 0) {
        setProgressText(`已入库 ${ingested} / ${ids.length} 个（${failed.length} 个失败）。`);
      } else {
        setProgressText(`已入库 ${ingested} 个 Demo，正在刷新列表…`);
      }
      setLibraryAdvFilters((prev) => ({ ...prev, status: "all" }));
      setLibraryPage(1);
      await refreshDemoLibrary(1, { manageLoading: false });
    } catch (e) {
      setProgressText(`入库请求失败: ${e.response?.data?.detail || e.message}`);
    } finally {
      setLibraryLoadingOverlay(false);
    }
  }, [refreshDemoLibrary]);

  const handleOpenDemoInfo = useCallback((id) => {
    setDemoInfoModalDemoId(id);
    setDemoInfoModalOpen(true);
  }, []);

  const handleAddClipsToQueue = useCallback((clipDataList) => {
    if (!Array.isArray(clipDataList) || !clipDataList.length) return;
    addToQueue(clipDataList);
    setProgressText(`已将 ${clipDataList.length} 条片段加入录制队列`);
  }, [addToQueue]);

  const handleUpload = useCallback(async (files) => {
    const list = Array.isArray(files) ? files : [files];
    if (!list.length) return;

    setProgressText("正在上传并登记 Demo...");
    setParsing(true);

    try {
      const formData = new FormData();
      list.forEach((f) => formData.append("files", f));
      await API.post("/demo/upload-multiple", formData);
      setProgressText(`已上传 ${list.length} 个 Demo。请前往「待入库」选项卡进行元数据提取。`);
    } catch (e) {
      setProgressText(`上传失败: ${e.response?.data?.detail || e.message}`);
    } finally {
      setParsing(false);
    }
  }, []);

  const persistWarmupDefaults = useCallback(async (obj) => {
    setSavedRecordWarmupDefaults(obj);
    try {
      await API.put("config", { default_record_warmup: obj });
    } catch {
      /* silent */
    }
  }, []);

  const openBatchWarmup = useCallback(() => {
    if (!queue.length) return;
    if (configBackupStatus?.restore_required) {
      setRecordingBlockedMessage(
        "检测到上次录制可能异常退出，玩家配置尚未恢复。\n请先点击「一键恢复玩家配置」，恢复完成后再开始新的录制。",
      );
      return;
    }
    setQueueDrawerOpen(false);
    setWarmupIntent("batch");
    setRecordWarmupOpen(true);
  }, [queue.length, configBackupStatus?.restore_required]);

  const handleWarmupConfirm = useCallback(
    async (warmup) => {
      const intent = warmupIntent;
      await persistWarmupDefaults(warmupApiPayloadToPersisted(warmup));

      setRecordWarmupOpen(false);
      if (intent === "batch") {
        setWarmupIntent(null);
        if (!queue.length) return;
        setBatchRecording(true);
        setProgressText("正在执行批量 OBS 导播…");
        try {
          const groups = buildBatchGroupsFromQueue(queue, globalPacing);
          const { data } = await API.post("/record/batch", { groups, warmup, obs: obsConfig });
          const results = data.results ?? [];
          const ok = results.filter((r) => r.status === "recorded").length;
          const aborted = results.filter((r) => r.status === "aborted").length;
          if (aborted > 0) {
            setProgressText(
              `批量录制已结束：成功 ${ok}，中止 ${aborted}，其余 ${results.length - ok - aborted} 条；共 ${results.length} 个片段。`,
            );
          } else {
            setProgressText(`批量录制完成！成功 ${ok} / ${results.length} 个片段。`);
          }
          clearQueue();
        } catch (e) {
          const detail = formatRecordingApiError(e);
          if (e.response?.status === 409 || e.response?.status === 422) {
            setRecordingBlockedMessage(detail || "录制启动失败");
          }
          setProgressText(`批量录制失败: ${detail}`);
        } finally {
          setBatchRecording(false);
          void refreshConfigBackupStatus();
        }
        return;
      }
      setWarmupIntent(null);
    },
    [
      warmupIntent,
      queue,
      clearQueue,
      obsConfig,
      globalPacing,
      persistWarmupDefaults,
      refreshConfigBackupStatus,
    ]
  );

  const handleRestorePlayerConfig = useCallback(async () => {
    setProgressText("正在恢复玩家配置…");
    try {
      const { data } = await API.post("/config-backup/restore");
      if (data?.ok) {
        setProgressText(data.message || "玩家配置已恢复");
      } else {
        setProgressText(data?.message || "部分配置恢复失败");
      }
      await refreshConfigBackupStatus();
    } catch (e) {
      const st = e.response?.status;
      const det = e.response?.data?.detail;
      if (st === 409 && det?.code === "CS2_RUNNING") {
        setRecordingBlockedMessage(
          "CS2 正在运行，无法覆盖配置文件。\n请先关闭 CS2，然后再次点击一键恢复。",
        );
      } else {
        setProgressText(`恢复失败: ${formatRecordingApiError(e)}`);
      }
      await refreshConfigBackupStatus();
    }
  }, [refreshConfigBackupStatus]);

  const handleOpenConfigBackupDir = useCallback(async () => {
    try {
      const { data } = await API.post("/config-backup/open-dir");
      if (data && data.ok === false && data.backup_dir) {
        setProgressText(`${data.message || "请手动打开"} ${data.backup_dir}`);
      }
    } catch (e) {
      setProgressText(`打开备份目录失败: ${formatRecordingApiError(e)}`);
    }
  }, []);

  const handleAbortBatchRecording = useCallback(async () => {
    try {
      const { data } = await API.post("/record/abort");
      setProgressText(data?.message || "已发送中止请求。");
    } catch (e) {
      setProgressText(`中止失败: ${e.response?.data?.detail || e.message}`);
    }
  }, []);

  const handleSaveConfig = useCallback(async (config) => {
    try {
      await API.put("config", config);
    } catch {
      // silent
    }
  }, []);

  const handleSaveExpectedParsePlayers = useCallback(async () => {
    const arr = expectedParsePlayersText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await API.put("config", { expected_parse_players: arr });
      setProgressText(
        arr.length
          ? `已保存 ${arr.length} 个关注昵称（同一场 Demo 可对多名并排写入库展示名）。`
          : "已清空关注名单。",
      );
    } catch (e) {
      setProgressText(`保存关注名单失败: ${e.response?.data?.detail || e.message}`);
    }
  }, [expectedParsePlayersText]);

  const hasLibraryAdvancedFilters = useMemo(() => {
    const f = libraryAdvFilters;
    return !!(f.mapName.trim() || (f.status && f.status !== "all") || f.playerQuery.trim());
  }, [libraryAdvFilters]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await API.get("config");
        if (cancelled) return;
        if (data.obs) {
          const rawPw = data.obs.password ?? "";
          const masked = typeof rawPw === "string" && rawPw.startsWith("****");
          setObsHasSavedPassword(masked);
          setObsPasswordEditing(false);
          setObsConfig({
            ...data.obs,
            password: "",
          });
        }
        if (data.llm) {
          const rawKey = data.llm.api_key ?? "";
          const masked = typeof rawKey === "string" && rawKey.startsWith("****");
          setLlmKeySavedOnServer(masked);
          setLlmConfig({
            ...data.llm,
            api_key: masked ? "" : rawKey,
          });
        }
        if (typeof data.ai_mode === "boolean") setAiMode(data.ai_mode);
        if (data.cs2_path) setCs2Path(data.cs2_path);
        if (typeof data.cs2_fps_max === "number") setCs2FpsMax(data.cs2_fps_max);
        if (Array.isArray(data.demo_watch_paths)) setDemoWatchPaths(data.demo_watch_paths);
        if (Array.isArray(data.expected_parse_players)) {
          setExpectedParsePlayersText(data.expected_parse_players.join("\n"));
        }
        if (
          data.default_record_warmup &&
          typeof data.default_record_warmup === "object" &&
          !Array.isArray(data.default_record_warmup)
        ) {
          setSavedRecordWarmupDefaults(data.default_record_warmup);
        }
        if (
          data.recording_global_pacing &&
          typeof data.recording_global_pacing === "object" &&
          !Array.isArray(data.recording_global_pacing)
        ) {
          useRecordingQueue.getState().hydrateGlobalPacing(data.recording_global_pacing);
        }
        if (!cancelled) {
          obsConfigHydratedRef.current = true;
          setConfigLoaded(true);
          queueMicrotask(() => {
            pacingPersistReadyRef.current = true;
          });
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void refreshConfigBackupStatus();
  }, [refreshConfigBackupStatus]);

  useEffect(() => {
    if (!pacingPersistReadyRef.current) return;
    const t = setTimeout(() => {
      void API.put("config", { recording_global_pacing: globalPacing }).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [globalPacing]);

  useEffect(() => {
    void refreshDemoLibrary(libraryPage, { manageLoading: false });
  }, [refreshDemoLibrary, libraryPage]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-cs2-bg text-cs2-text-primary">
      <Sidebar
        aiMode={aiMode}
        onAiModeChange={setAiMode}
        obsConfig={obsConfig}
        onObsConfigChange={setObsConfig}
        obsPasswordPlaceholder={obsHasSavedPassword && !obsPasswordEditing ? "********" : "输入以覆盖"}
        onObsPasswordFocus={() => setObsPasswordEditing(true)}
        onObsPasswordBlur={() => setObsPasswordEditing(false)}
        onPersistObs={async () => {
          await handleSaveConfig({ obs: obsConfig });
          setObsHasSavedPassword(true);
        }}
        llmConfig={llmConfig}
        onLlmConfigChange={setLlmConfig}
        llmKeySavedOnServer={llmKeySavedOnServer}
        onPersistLlm={async () => {
          await handleSaveConfig({ llm: llmConfig });
          setLlmKeySavedOnServer(true);
        }}
        cs2Path={cs2Path}
        onCs2PathChange={setCs2Path}
        cs2FpsMax={cs2FpsMax}
        onCs2FpsMaxChange={setCs2FpsMax}
        demoWatchPaths={demoWatchPaths}
        onDemoWatchPathsChange={setDemoWatchPaths}
        onSaveConfig={handleSaveConfig}
        onDetectCs2={async () => {
          const { data } = await API.post("/env/detect-cs2");
          if (data.cs2_path) setCs2Path(data.cs2_path);
          return data;
        }}
        onScanDemos={handleScanDemos}
        demoLibraryLoading={libraryLoading}
        expectedParsePlayersText={expectedParsePlayersText}
        onExpectedParsePlayersTextChange={setExpectedParsePlayersText}
        onSaveExpectedParsePlayers={handleSaveExpectedParsePlayers}
        configLoaded={configLoaded}
      />

      <main 
        className="relative flex-1 flex flex-col min-w-0 bg-[#0a0a0a]"
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith(".dem"));
          if (files.length > 0) {
            void handleUpload(files);
          }
        }}
      >
        {/* Main Content Scroll Area */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 px-4">
          <section className="flex flex-col gap-4 max-w-[100rem] mx-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-8 w-1 bg-cs2-orange rounded-full" />
                <h2 className="text-xl font-black uppercase tracking-tight text-white flex items-center gap-2">
                  <Database className="h-5 w-5 text-cs2-orange" />
                  本地 Demo 库
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <div className="mr-2 flex items-center rounded-lg bg-black/40 p-1 border border-white/5 shadow-inner">
                  <button
                    onClick={() => setLibraryViewMode("grid")}
                    className={`p-1.5 rounded-md transition-all ${libraryViewMode === "grid" ? "bg-cs2-orange text-black shadow-md" : "text-zinc-600 hover:text-zinc-300"}`}
                    title="网格视图"
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setLibraryViewMode("list")}
                    className={`p-1.5 rounded-md transition-all ${libraryViewMode === "list" ? "bg-cs2-orange text-black shadow-md" : "text-zinc-600 hover:text-zinc-300"}`}
                    title="列表视图"
                  >
                    <List className="h-3.5 w-3.5" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setIngestModalOpen(true)}
                  className="group flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-bold uppercase transition-all hover:bg-white/10 hover:border-cs2-orange/50"
                >
                  <PlusCircle className="h-3.5 w-3.5 text-cs2-orange" />
                  待入库
                </button>
                <button
                  type="button"
                  onClick={() => void refreshDemoLibrary(1)}
                  disabled={libraryLoading}
                  className="rounded-lg border border-white/10 bg-black/40 p-1.5 text-zinc-400 hover:text-white transition-colors"
                  title="刷新库"
                >
                  <RotateCw className={`h-4 w-4 ${libraryLoading ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 bg-cs2-bg-card/50 p-3 rounded-xl border border-white/5 shadow-inner">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
                <input
                  type="text"
                  className="w-full bg-black/40 border border-white/10 rounded-lg py-2 pl-9 pr-4 text-xs text-white placeholder:text-zinc-600 outline-none focus:border-cs2-orange/40 transition-colors"
                  placeholder="搜索 Demo 文件名或展示名..."
                  value={librarySearchInput}
                  onChange={(e) => setLibrarySearchInput(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-3.5 w-3.5 text-zinc-500" />
                <select
                  className="bg-black/40 border border-white/10 rounded-lg py-2 px-3 text-xs text-zinc-300 outline-none focus:border-cs2-orange/40 cursor-pointer"
                  value={libraryAdvFilters.status}
                  onChange={(e) => setLibraryAdvFilters((p) => ({ ...p, status: e.target.value }))}
                >
                  <option value="all">全部状态</option>
                  {DEMO_LIBRARY_STATUS_FILTER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>

                <select
                  className="bg-black/40 border border-white/10 rounded-lg py-2 px-3 text-xs text-zinc-300 outline-none focus:border-cs2-orange/40 cursor-pointer"
                  value={libraryAdvFilters.mapName}
                  onChange={(e) => setLibraryAdvFilters((p) => ({ ...p, mapName: e.target.value }))}
                >
                  <option value="">全部地图</option>
                  {DEMO_LIBRARY_MAP_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div
              className={
                libraryViewMode === "grid"
                  ? "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
                  : "flex flex-col gap-2"
              }
            >
              {demoLibraryItems.length === 0 && !libraryLoading && (
                <div className="col-span-full flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/5 bg-black/20 py-20">
                  <FolderOpen className="mb-4 h-10 w-10 text-zinc-700" />
                  <p className="text-sm text-zinc-500">
                    {librarySearchQ ? "未找到相关 Demo" : "库中暂无数据"}
                  </p>
                </div>
              )}
              {demoLibraryItems.map((it) =>
                libraryViewMode === "grid" ? (
                  <MatchCard
                    key={it.id}
                    demo={it}
                    isSelected={selectedLibraryDemoIds.has(it.id)}
                    onSelect={(id, checked) => {
                      setSelectedLibraryDemoIds((prev) => {
                        const next = new Set(prev);
                        if (checked) next.add(id);
                        else next.delete(id);
                        return next;
                      });
                    }}
                    onPlay={handlePlayDemo}
                    onOpenFile={handleOpenDemoFile}
                    onDelete={(id, filename) =>
                      setDeleteConfirmOpen({ id, filename, deleteFile: false })
                    }
                    onUpdateRemark={handleUpdateRemark}
                    onOpenInfo={handleOpenDemoInfo}
                    expectedPlayers={expectedPreviewLines}
                  />
                ) : (
                  <MatchListRow
                    key={it.id}
                    demo={it}
                    isSelected={selectedLibraryDemoIds.has(it.id)}
                    onSelect={(id, checked) => {
                      setSelectedLibraryDemoIds((prev) => {
                        const next = new Set(prev);
                        if (checked) next.add(id);
                        else next.delete(id);
                        return next;
                      });
                    }}
                    onPlay={handlePlayDemo}
                    onOpenFile={handleOpenDemoFile}
                    onDelete={(id, filename) =>
                      setDeleteConfirmOpen({ id, filename, deleteFile: false })
                    }
                    onUpdateRemark={handleUpdateRemark}
                    onOpenInfo={handleOpenDemoInfo}
                    expectedPlayers={expectedPreviewLines}
                  />
                )
              )}
            </div>

            {/* Pagination */}
            {libraryTotalPages > 1 && (
              <div className="flex items-center justify-center gap-4 py-6">
                <button
                  disabled={libraryPage <= 1}
                  onClick={() => {
                    const next = libraryPage - 1;
                    setLibraryPage(next);
                    void refreshDemoLibrary(next, { manageLoading: false });
                  }}
                  className="p-2 rounded-lg border border-white/10 bg-black/40 text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
                  第 {libraryPage} / {libraryTotalPages} 页
                </span>
                <button
                  disabled={!libraryHasNextPage}
                  onClick={() => {
                    const next = libraryPage + 1;
                    setLibraryPage(next);
                    void refreshDemoLibrary(next, { manageLoading: false });
                  }}
                  className="p-2 rounded-lg border border-white/10 bg-black/40 text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
              )}
              </section>
              </div>
        {/* Global Progress and Action Bar */}
        <div className="bg-cs2-bg-dark border-t border-cs2-border px-6 py-4 shadow-2xl">
          <div className="max-w-[100rem] mx-auto flex items-center justify-between gap-6 px-4">
            <div className="flex-1 min-w-0">
               {anyDemoParsing || progressText || batchRecording ? (
                 <ProgressBar
                    text={progressText || (batchRecording ? "正在批量录制…" : "")}
                    active={anyDemoParsing}
                    batchRecording={batchRecording}
                    onAbortBatch={handleAbortBatchRecording}
                  />
               ) : (
                 <div className="flex items-center gap-3 text-zinc-500">
                    <History className="h-4 w-4" />
                    <span className="text-[11px] font-medium truncate uppercase tracking-wider">
                      准备就绪 • 请选择 Demo 进行高光提取或直接开始录制
                    </span>
                 </div>
               )}
            </div>
            
            <div className="flex items-center gap-3 shrink-0">
               <button
                 onClick={() => setQueueDrawerOpen(true)}
                 disabled={queue.length === 0}
                 className="relative flex items-center gap-2 rounded-lg bg-cs2-orange px-6 py-2.5 text-sm font-black uppercase tracking-tighter text-black transition-all hover:bg-cs2-orange-light shadow-lg shadow-cs2-orange/20 active:scale-95 disabled:opacity-30 disabled:grayscale disabled:shadow-none"
               >
                 <Video className="h-4 w-4" />
                 录制队列
                 {queue.length > 0 && (
                   <span className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] font-black text-black ring-4 ring-[#0a0a0a] animate-in zoom-in duration-300">
                     {queue.length}
                   </span>
                 )}
               </button>

               {configBackupStatus?.restore_required && (
                 <button
                    onClick={handleRestorePlayerConfig}
                    className="flex items-center gap-2 rounded-lg bg-red-500/20 px-4 py-2 text-xs font-bold text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-all"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    恢复配置
                  </button>
               )}
            </div>
          </div>
        </div>
      </main>

      <CommonParamsModal
        open={commonParamsOpen}
        onClose={() => setCommonParamsOpen(false)}
        batchRecording={batchRecording}
        savedWarmupDefaults={savedRecordWarmupDefaults}
        onPersistWarmupDefaults={persistWarmupDefaults}
      />

      <RecordingQueueDrawer
        open={queueDrawerOpen}
        onClose={() => setQueueDrawerOpen(false)}
        queue={queue}
        onRemove={removeFromQueue}
        onClear={clearQueue}
        onStartBatch={openBatchWarmup}
        batchRecording={batchRecording}
        onAbortBatch={handleAbortBatchRecording}
      />

      <RecordWarmupModal
        open={recordWarmupOpen}
        onClose={() => {
          setRecordWarmupOpen(false);
          setWarmupIntent(null);
        }}
        onConfirm={handleWarmupConfirm}
        onWarmupValidationError={(msg) => setRecordingBlockedMessage(msg)}
        defaultOverrides={savedRecordWarmupDefaults ?? undefined}
      />

      <IngestModal
        isOpen={ingestModalOpen}
        onClose={() => setIngestModalOpen(false)}
        onIngest={handleBatchIngest}
        onUpload={handleUpload}
      />

      <DemoInfoModal
        open={demoInfoModalOpen}
        onClose={() => { setDemoInfoModalOpen(false); setDemoInfoModalDemoId(null); }}
        demoId={demoInfoModalDemoId}
        onAddToQueue={handleAddClipsToQueue}
        expectedPlayers={expectedPreviewLines}
        aiMode={aiMode}
        queuedClientClipUids={queuedClientClipUidsGlobal}
      />

      {deleteConfirmOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="card-delete-title"
          onClick={() => setDeleteConfirmOpen(false)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-xl border border-white/10 bg-cs2-bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 border-b border-white/10 px-6 py-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-500">
                <Trash2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 pr-7">
                <h2 id="card-delete-title" className="text-sm font-bold text-white uppercase tracking-tight">
                  删除 Demo
                </h2>
                <p className="mt-1 text-[11px] font-mono text-zinc-500 truncate">{deleteConfirmOpen.filename}</p>
              </div>
            </div>

            <div className="px-6 py-4">
              <p className="text-sm leading-6 text-zinc-300">
                确定要将此 Demo 从本地库中移除吗？解析产生的缓存也将被同步清理。
              </p>
              <label className="mt-4 flex items-center gap-3 cursor-pointer group">
                <div className="relative flex items-center">
                  <input
                    type="checkbox"
                    checked={deleteConfirmOpen.deleteFile}
                    onChange={(e) => setDeleteConfirmOpen((prev) => ({ ...prev, deleteFile: e.target.checked }))}
                    className="peer h-4 w-4 rounded border-white/20 bg-black/40 text-red-500 focus:ring-0 focus:ring-offset-0"
                  />
                </div>
                <span className="text-xs font-medium text-zinc-400 group-hover:text-zinc-200 transition-colors">同时删除磁盘上的 .dem 源文件</span>
              </label>
            </div>

            <div className="flex flex-col gap-2 border-t border-white/10 bg-black/20 px-6 py-4">
              <button
                type="button"
                className="w-full rounded-lg bg-white/5 border border-white/10 py-2.5 text-xs font-bold text-white transition-all hover:bg-white/10"
                onClick={() => void handleDeleteFromCard(deleteConfirmOpen.id, "reimport", deleteConfirmOpen.deleteFile)}
              >
                仅从库中删除 (下次扫描会重新发现)
              </button>
              <button
                type="button"
                className="w-full rounded-lg bg-red-500/10 border border-red-500/20 py-2.5 text-xs font-black text-red-400 transition-all hover:bg-red-500/20"
                onClick={() => void handleDeleteFromCard(deleteConfirmOpen.id, "skip", deleteConfirmOpen.deleteFile)}
              >
                永久忽略此文件 (下次扫描将跳过)
              </button>
              <button
                type="button"
                className="mt-1 w-full py-2 text-xs font-medium text-zinc-500 hover:text-zinc-300 transition-colors"
                onClick={() => setDeleteConfirmOpen(false)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <LibraryLoadModeModal
        open={libraryBatchModalOpen}
        onClose={() => setLibraryBatchModalOpen(false)}
        expectedPreviewLines={expectedPreviewLines}
        onConfirm={(payload) => {
          setLibraryBatchModalOpen(false);
          // 这里的批量载入逻辑也需要根据新流程调整，暂时保留结构
        }}
      />

      <RecordingBlockedDialog
        message={recordingBlockedMessage}
        onClose={() => setRecordingBlockedMessage("")}
      />

      {/* 全局加载遮制层 */}
      {libraryLoadingOverlay && (
        <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-300">
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-cs2-bg-card p-10 shadow-2xl">
            <Loader2 className="h-10 w-10 animate-spin text-cs2-orange" />
            <div className="flex flex-col items-center gap-1">
              <p className="text-sm font-black uppercase tracking-widest text-white">{libraryLoadingText}</p>
              <p className="text-[10px] text-zinc-500 uppercase font-bold">请稍候，正在同步数据</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
