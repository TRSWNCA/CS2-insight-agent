"""本地合辑：FFmpeg 探测、片段归一化拼接、可选片头片尾与 BGM 混音。"""

from __future__ import annotations

import json
import logging
import math
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)


class MontageComposerError(Exception):
    """可映射为 HTTP 400/500 的合成错误。"""


def resolve_ffmpeg_binary(ffmpeg_path: str | None) -> Path:
    raw = (ffmpeg_path or "").strip()
    if raw:
        p = Path(raw).expanduser()
        if p.is_file():
            return p.resolve()
        raise MontageComposerError(f"配置的 FFmpeg 不存在或不可执行: {raw}")
    found = shutil.which("ffmpeg")
    if not found:
        raise MontageComposerError(
            "未找到 FFmpeg。请在配置中填写 ffmpeg.exe 完整路径，或将其加入系统 PATH。",
        )
    return Path(found).resolve()


def resolve_ffprobe_binary(ffmpeg_bin: Path) -> Path:
    """与 ffmpeg 同目录的 ffprobe，否则 PATH。"""
    probe = ffmpeg_bin.parent / ("ffprobe.exe" if os.name == "nt" else "ffprobe")
    if probe.is_file():
        return probe.resolve()
    w = shutil.which("ffprobe")
    if w:
        return Path(w).resolve()
    raise MontageComposerError("未找到 ffprobe（通常与 FFmpeg 一同安装）。")


def _run_json(cmd: list[str]) -> dict[str, Any]:
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "").strip()[-800:]
        raise MontageComposerError(f"ffprobe 失败 (exit {proc.returncode}): {tail}")
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        raise MontageComposerError(f"ffprobe 输出非 JSON: {e}") from e


def ffprobe_streams(path: Path, ffprobe: Path) -> dict[str, Any]:
    return _run_json(
        [
            str(ffprobe),
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=index,codec_type,width,height,r_frame_rate,channels,sample_rate",
            "-of",
            "json",
            str(path),
        ],
    )


def parse_r_frame_rate(s: str) -> float:
    s = (s or "").strip()
    if not s or s == "0/0":
        return 60.0
    if "/" in s:
        a, b = s.split("/", 1)
        try:
            bf = float(b)
            return float(a) / bf if bf else 60.0
        except ValueError:
            return 60.0
    try:
        return float(s)
    except ValueError:
        return 60.0


def probe_video_audio_summary(path: Path, ffprobe: Path) -> dict[str, Any]:
    data = ffprobe_streams(path, ffprobe)
    fmt = data.get("format") or {}
    dur_s: Optional[float] = None
    try:
        d = float(fmt.get("duration") or 0)
        dur_s = d if d > 0 else None
    except (TypeError, ValueError):
        dur_s = None
    streams = data.get("streams") or []
    vw = vh = 1920, 1080
    fps = 60.0
    has_audio = False
    for st in streams:
        if not isinstance(st, dict):
            continue
        ct = str(st.get("codec_type") or "")
        if ct == "video":
            try:
                vw = int(st.get("width") or vw)
                vh = int(st.get("height") or vh)
            except (TypeError, ValueError):
                pass
            fps = parse_r_frame_rate(str(st.get("r_frame_rate") or ""))
        elif ct == "audio":
            has_audio = True
    return {"width": vw, "height": vh, "fps": fps, "has_audio": has_audio, "duration": dur_s}


def validate_output_path(path_str: str) -> Path:
    raw = (path_str or "").strip()
    if not raw:
        raise MontageComposerError("输出路径为空")
    p = Path(raw).expanduser()
    if not p.is_absolute():
        raise MontageComposerError("输出路径必须是绝对路径")
    if p.suffix.lower() != ".mp4":
        raise MontageComposerError("输出文件必须是 .mp4")
    try:
        resolved = p.resolve()
    except OSError as e:
        raise MontageComposerError(f"输出路径无效: {e}") from e
    if ".." in p.parts:
        raise MontageComposerError("输出路径不能包含 '..' 段")
    parent = resolved.parent
    if not parent.exists():
        try:
            parent.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            raise MontageComposerError(f"无法创建输出目录: {e}") from e
    if parent.exists() and not parent.is_dir():
        raise MontageComposerError("输出目录路径不是文件夹")
    return resolved


def build_bgm_filter(video_duration_sec: float, bgm_input_label: str = "[1:a]") -> str:
    """
    生成将 BGM 对齐到成片时长的 filter 片段（不含 amix）。
    BGM 短于成片则循环；长于成片则裁剪。
    """
    d = max(0.01, float(video_duration_sec))
    # aloop 用于延长短音频；atrim 裁到视频时长
    return (
        f"{bgm_input_label}aloop=loop=-1:size=2e+09,atrim=0:{d:.6f},asetpts=N/SR/TB[bgmtrim]"
    )


def _concat_file_line(p: Path) -> str:
    s = p.resolve().as_posix()
    s = s.replace("'", "'\\''")
    return f"file '{s}'"


def compose_montage(
    *,
    ffmpeg_bin: Path,
    clip_paths: list[Path],
    intro_path: Optional[Path],
    outro_path: Optional[Path],
    bgm_path: Optional[Path],
    output_path: Path,
) -> None:
    if not clip_paths:
        raise MontageComposerError("片段列表为空")
    for c in clip_paths:
        if not c.is_file():
            raise MontageComposerError(f"片段文件不存在: {c}")
    if intro_path is not None and not intro_path.is_file():
        raise MontageComposerError(f"片头文件不存在: {intro_path}")
    if outro_path is not None and not outro_path.is_file():
        raise MontageComposerError(f"片尾文件不存在: {outro_path}")
    if bgm_path is not None and not bgm_path.is_file():
        raise MontageComposerError(f"BGM 文件不存在: {bgm_path}")

    ffprobe = resolve_ffprobe_binary(ffmpeg_bin)
    # 以首段为主分辨率 / 帧率
    ref = probe_video_audio_summary(clip_paths[0], ffprobe)
    w, h, fps = int(ref["width"]), int(ref["height"]), float(ref["fps"])
    if w <= 0 or h <= 0:
        raise MontageComposerError("无法读取首段视频分辨率")
    fps_s = f"{fps:.4f}".rstrip("0").rstrip(".")

    segments: list[Path] = []
    if intro_path is not None:
        segments.append(intro_path)
    segments.extend(clip_paths)
    if outro_path is not None:
        segments.append(outro_path)

    tmpdir = tempfile.mkdtemp(prefix="cs2_montage_", dir=str(output_path.parent))
    try:
        normed: list[Path] = []
        for i, seg in enumerate(segments):
            info = probe_video_audio_summary(seg, ffprobe)
            dur = info.get("duration")
            if dur is None or dur <= 0:
                dur = 0.1
            vf = (
                f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
                f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,fps={fps_s},setsar=1,format=yuv420p"
            )
            out_ts = Path(tmpdir) / f"norm_{i:03d}.ts"
            if info["has_audio"]:
                fc = f"[0:v]{vf}[v];[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a]"
                cmd = [
                    str(ffmpeg_bin),
                    "-y",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-i",
                    str(seg),
                    "-filter_complex",
                    fc,
                    "-map",
                    "[v]",
                    "-map",
                    "[a]",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "medium",
                    "-crf",
                    "18",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "192k",
                    "-shortest",
                    str(out_ts),
                ]
            else:
                fc = (
                    f"[0:v]{vf}[v];"
                    f"anullsrc=r=48000:cl=stereo,atrim=0:{float(dur):.6f},asetpts=N/SR/TB[a]"
                )
                cmd = [
                    str(ffmpeg_bin),
                    "-y",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-i",
                    str(seg),
                    "-filter_complex",
                    fc,
                    "-map",
                    "[v]",
                    "-map",
                    "[a]",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "medium",
                    "-crf",
                    "18",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "192k",
                    "-shortest",
                    str(out_ts),
                ]
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)
            if r.returncode != 0:
                raise MontageComposerError(
                    f"片段归一化失败 ({seg.name}): {(r.stderr or r.stdout or '').strip()[-600:]}",
                )
            normed.append(out_ts)

        concat_list = Path(tmpdir) / "concat.txt"
        lines = [_concat_file_line(p) for p in normed]
        concat_list.write_text("\n".join(lines) + "\n", encoding="utf-8")

        mid_mp4 = Path(tmpdir) / "mid.mp4"
        cmd_concat = [
            str(ffmpeg_bin),
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_list),
            "-c",
            "copy",
            str(mid_mp4),
        ]
        r2 = subprocess.run(cmd_concat, capture_output=True, text=True, timeout=3600)
        if r2.returncode != 0:
            raise MontageComposerError(
                f"拼接失败: {(r2.stderr or r2.stdout or '').strip()[-600:]}",
            )

        mid_info = ffprobe_streams(mid_mp4, ffprobe)
        try:
            vdur = float((mid_info.get("format") or {}).get("duration") or 0)
        except (TypeError, ValueError):
            vdur = 0.0
        if vdur <= 0:
            vdur = 0.01

        if bgm_path is None:
            shutil.move(str(mid_mp4), str(output_path))
            return

        fc_mix = (
            f"[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[ga];"
            f"{build_bgm_filter(vdur, '[1:a]')};"
            f"[ga][bgmtrim]amix=inputs=2:duration=first:dropout_transition=0[aout]"
        )
        cmd_mix = [
            str(ffmpeg_bin),
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(mid_mp4),
            "-i",
            str(bgm_path),
            "-filter_complex",
            fc_mix,
            "-map",
            "0:v",
            "-map",
            "[aout]",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            str(output_path),
        ]
        r3 = subprocess.run(cmd_mix, capture_output=True, text=True, timeout=3600)
        if r3.returncode != 0:
            raise MontageComposerError(
                f"BGM 混音失败: {(r3.stderr or r3.stdout or '').strip()[-600:]}",
            )
    finally:
        try:
            shutil.rmtree(tmpdir, ignore_errors=True)
        except Exception:
            logger.debug("montage temp cleanup failed", exc_info=True)
