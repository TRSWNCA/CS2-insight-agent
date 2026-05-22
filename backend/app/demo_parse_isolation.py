"""Direct calls to demo_parser with exception handling (no subprocess isolation)."""

from __future__ import annotations

from typing import Any, Optional

from .demo_parser import DemoAnalyzer, get_demo_match_summary, get_player_list


class ParseError(RuntimeError):
    pass


def _wrap(action: str, fn, *args, **kwargs) -> Any:
    try:
        return fn(*args, **kwargs)
    except BaseException as e:  # noqa: BLE001 — catch PanicException etc.
        raise ParseError(f"{action} 解析失败: {type(e).__name__}: {e}") from e


def analyze_demo_isolated(
    dem_path: str,
    target_player: str,
    freeze_to_death_rounds: Optional[list[int]] = None,
) -> dict:
    def _run():
        return DemoAnalyzer(dem_path).analyze(
            target_player, freeze_to_death_rounds=freeze_to_death_rounds
        ).to_dict()

    return _wrap("analyze", _run)


def get_player_list_isolated(dem_path: str) -> list[dict]:
    return _wrap("players", get_player_list, dem_path)


def get_demo_match_summary_isolated(dem_path: str) -> dict:
    return _wrap("summary", get_demo_match_summary, dem_path)


def extract_radar_timeline_isolated(**kwargs: Any) -> Any:
    from .radar.radar_data_extractor import extract_radar_timeline_impl

    return _wrap("radar_timeline", extract_radar_timeline_impl, **kwargs)
