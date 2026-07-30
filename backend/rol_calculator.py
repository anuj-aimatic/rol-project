"""ROL calculation — produces static and dynamic ROL values per SKU.

Static ROL:  bin_size from volume_logic(total_sales)
Dynamic ROL: bin_size = mode of weekly demand for that item
             (matches notebook: Mode_Qty from weekly demand aggregation)
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from backend.config import (
    DEFAULT_LEAD_TIME_WEEKS,
    DEFAULT_SERVICE_LEVEL,
    HIGH_BIN_SIZE,
    INTERPOLATION_THRESHOLD,
    LOW_VOLUME_THRESHOLD,
    MEDIUM_BIN_SIZE,
    MEDIUM_VOLUME_THRESHOLD,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _volume_logic(total_sales: float) -> int:
    if total_sales <= LOW_VOLUME_THRESHOLD:
        return 0
    if total_sales <= MEDIUM_VOLUME_THRESHOLD:
        return MEDIUM_BIN_SIZE
    return HIGH_BIN_SIZE


def _compute_total_weeks(weekly: pd.DataFrame) -> int:
    return int((weekly["Year"].astype(str) + "-" + weekly["Week"].astype(str)).nunique())


def _build_frequency_df(weekly_vals: pd.Series, bin_size: int, total_weeks: int) -> pd.DataFrame:
    """Build frequency distribution with zero-demand adjustment (notebook logic)."""
    max_val = int(weekly_vals.max())

    bins: list[tuple[int, int]] = [(0, 0)]
    start = 1
    while start <= max_val:
        end = start + bin_size - 1
        bins.append((start, end))
        start = end + 1

    rows: list[dict] = []
    for lo, hi in bins:
        if lo == 0:
            rows.append({"Lower": lo, "Upper": hi, "Frequency": 0})
        else:
            cnt = int(weekly_vals.between(lo, hi).sum())
            rows.append({"Lower": lo, "Upper": hi, "Frequency": cnt})

    freq_df = pd.DataFrame(rows)

    # Zero-bucket adjustment (notebook logic)
    non_zero = int(freq_df.loc[1:, "Frequency"].sum())
    freq_df.loc[0, "Frequency"] = max(0, total_weeks - non_zero)

    freq_df["Contribution"] = freq_df["Frequency"] / total_weeks
    freq_df["Cum Probability"] = freq_df["Contribution"].cumsum()
    freq_df["Mid Point"] = (freq_df["Lower"] + freq_df["Upper"]) / 2.0
    freq_df["Weighted Sum"] = freq_df["Mid Point"] * freq_df["Contribution"]

    return freq_df


def _compute_dmax(freq_df: pd.DataFrame, service_level: float) -> float:
    """Compute Dmax at service level using interpolation or nearest bucket.

    Edge case guard: if the zero-bucket dominates (cumulative probability >= service_level),
    Dmax defaults to the first non-zero bucket's Upper instead of 0.
    This prevents ROL=0 for items with sparse but actual demand.
    """
    if freq_df.empty or "Cum Probability" not in freq_df.columns:
        return 0.0

    below = freq_df[freq_df["Cum Probability"] < service_level]
    if below.empty:
        # Zero bucket alone exceeds service level -> first non-zero bucket
        if len(freq_df) > 1:
            return float(freq_df.iloc[1]["Upper"])
        return 0.0

    below_row = below.iloc[-1]

    above = freq_df[freq_df["Cum Probability"] >= service_level]
    if above.empty:
        return float(freq_df.iloc[-1]["Upper"])
    above_row = above.iloc[0]

    gap = above_row["Cum Probability"] - below_row["Cum Probability"]
    if gap > INTERPOLATION_THRESHOLD:
        frac = (service_level - below_row["Cum Probability"]) / gap
        dmax = below_row["Upper"] + frac * (above_row["Upper"] - below_row["Upper"])
        # Guard: don't round down to 0 when non-zero demand exists
        if round(dmax) == 0 and above_row["Upper"] > 0:
            return float(above_row["Upper"])
        return round(dmax)

    # Nearest bucket — prefer first non-zero bucket over zero bucket on ties
    probs = freq_df["Cum Probability"].values
    idx = int(np.argmin(np.abs(probs - service_level)))
    result = float(freq_df.iloc[idx]["Upper"])
    if result == 0 and len(freq_df) > 1:
        return float(freq_df.iloc[1]["Upper"])
    return result


def _rol_metrics(d_avg_week: float, d_max_week: float, lead_time: int) -> dict[str, float]:
    """Compute safety stock and reorder level."""
    ss = (d_max_week - d_avg_week) * lead_time
    rol_monthly = (d_avg_week * 4) + ss
    return {"rol": round(rol_monthly, 2), "ss": round(ss, 2), "dmax": round(d_max_week, 2)}


# ---------------------------------------------------------------------------
# Per-SKU ROL (single item)
# ---------------------------------------------------------------------------

def compute_rol_for_item(
    weekly: pd.DataFrame,
    item_code: str,
    bin_size: int,
    total_weeks: int | None = None,
    service_level: float = DEFAULT_SERVICE_LEVEL,
    lead_time: int = DEFAULT_LEAD_TIME_WEEKS,
) -> dict[str, float]:
    """Compute ROL for a single SKU with a given bin_size.

    Returns dict with keys: rol, safety_stock, d_avg_week, d_max_week.
    """
    w = weekly[weekly["Item Code"] == item_code]
    if w.empty:
        return {"rol": 0.0, "safety_stock": 0.0, "d_avg_week": 0.0, "d_max_week": 0.0}

    if total_weeks is None:
        total_weeks = _compute_total_weeks(weekly)

    vals = w["Weekly Demand"]

    if bin_size <= 0:
        d_avg = float(vals.mean())
        d_max = float(vals.max())
        m = _rol_metrics(d_avg, d_max, lead_time)
        return {"rol": m["rol"], "safety_stock": m["ss"], "d_avg_week": round(d_avg, 2), "d_max_week": m["dmax"]}

    freq_df = _build_frequency_df(vals, bin_size, total_weeks)
    d_avg = float(freq_df["Weighted Sum"].sum())
    d_max = _compute_dmax(freq_df, service_level)
    m = _rol_metrics(d_avg, d_max, lead_time)

    return {"rol": m["rol"], "safety_stock": m["ss"], "d_avg_week": round(d_avg, 2), "d_max_week": m["dmax"]}


# ---------------------------------------------------------------------------
# Batch ROL for all SKUs in the combined output
# ---------------------------------------------------------------------------

def add_rol_columns(
    final_df: pd.DataFrame,
    weekly: pd.DataFrame,
    service_level: float = DEFAULT_SERVICE_LEVEL,
    lead_time: int = DEFAULT_LEAD_TIME_WEEKS,
) -> pd.DataFrame:
    """Add ``rol_static``, ``rol_dynamic`` and detailed ROL metric columns.

    For each SKU the following groups of columns are appended:

    **Static group** (bin_size = volume_logic(total_sales)):
    ``rol_static``, ``st_weeks_with_orders``, ``st_total_sales``,
    ``st_avg_weekly_demand``, ``st_avg_monthly_demand``, ``st_dmax_week``,
    ``st_max_monthly_demand``, ``st_safety_stock``, ``st_mode_weekly_demand``

    **Dynamic group** (bin_size = mode of weekly demand):
    ``rol_dynamic``, ``dy_weeks_with_orders``, ``dy_total_sales``,
    ``dy_avg_weekly_demand``, ``dy_avg_monthly_demand``, ``dy_dmax_week``,
    ``dy_max_monthly_demand``, ``dy_safety_stock``, ``dy_mode_weekly_demand``
    """
    df = final_df.copy()
    total_weeks_global = _compute_total_weeks(weekly)
    item_codes = df["Item_Code"].unique()

    # Prepare dicts for every metric column
    metrics: dict[str, dict[str, float]] = {ic: {} for ic in item_codes}

    for ic in item_codes:
        m = metrics[ic]
        w = weekly[weekly["Item Code"] == ic]

        if w.empty:
            for prefix in ("st_", "dy_"):
                m[f"{prefix}weeks_with_orders"] = 0
                m[f"{prefix}total_sales"] = 0.0
                m[f"{prefix}avg_weekly_demand"] = 0.0
                m[f"{prefix}avg_monthly_demand"] = 0.0
                m[f"{prefix}dmax_week"] = 0.0
                m[f"{prefix}max_monthly_demand"] = 0.0
                m[f"{prefix}safety_stock"] = 0.0
                m[f"{prefix}mode_weekly_demand"] = 0
            m["weeks_with_orders"] = 0
            m["rol_static"] = 0.0
            m["rol_dynamic"] = 0.0
            continue

        item_vals = w["Weekly Demand"]
        item_sales = float(item_vals.sum())
        weeks_with_orders = int((item_vals > 0).sum() if (item_vals > 0).any() else 0)
        mode_of_weekly = int(item_vals.mode().iloc[0]) if not item_vals.mode().empty else 0
        if mode_of_weekly <= 0:
            mode_of_weekly = 1

        # Shared base metrics (same for both static & dynamic except where noted)
        base_shared = {
            "weeks_with_orders": weeks_with_orders,
            "total_sales": round(item_sales, 2),
            "mode_weekly_demand": mode_of_weekly,
        }

        # Store bare weeks_with_orders for the standalone column
        m["weeks_with_orders"] = weeks_with_orders

        # ----- Static ROL -----
        static_bin = _volume_logic(item_sales)
        static_res = compute_rol_for_item(
            weekly, ic, static_bin, total_weeks_global, service_level, lead_time
        )
        d_avg = static_res["d_avg_week"]
        d_max = static_res["d_max_week"]
        m["rol_static"] = static_res["rol"]
        for k, v in base_shared.items():
            m[f"st_{k}"] = v
        m["st_avg_weekly_demand"] = d_avg
        m["st_avg_monthly_demand"] = round(d_avg * 4, 2)
        m["st_dmax_week"] = d_max
        m["st_max_monthly_demand"] = round(d_max * 4, 2)
        m["st_safety_stock"] = static_res["safety_stock"]

        # ----- Dynamic ROL -----
        dynamic_bin = mode_of_weekly
        dynamic_res = compute_rol_for_item(
            weekly, ic, dynamic_bin, total_weeks_global, service_level, lead_time
        )
        d_avg = dynamic_res["d_avg_week"]
        d_max = dynamic_res["d_max_week"]
        m["rol_dynamic"] = dynamic_res["rol"]
        for k, v in base_shared.items():
            m[f"dy_{k}"] = v
        m["dy_avg_weekly_demand"] = d_avg
        m["dy_avg_monthly_demand"] = round(d_avg * 4, 2)
        m["dy_dmax_week"] = d_max
        m["dy_max_monthly_demand"] = round(d_max * 4, 2)
        m["dy_safety_stock"] = dynamic_res["safety_stock"]

    # ---- Add standalone week-count columns ----
    df["total_weeks"] = total_weeks_global
    df["weeks_with_orders"] = df["Item_Code"].map(
        lambda ic: metrics[ic].get("weeks_with_orders", 0)
    )
    df["weeks_with_zero_orders"] = df["Item_Code"].map(
        lambda ic: max(0, total_weeks_global - metrics[ic].get("st_weeks_with_orders", 0))
    )

    # ---- Build all metric columns in order ----
    col_order = [
        "total_weeks",
        "weeks_with_orders",
        "weeks_with_zero_orders",
        "rol_static",
        "st_weeks_with_orders",
        "st_total_sales",
        "st_avg_weekly_demand",
        "st_avg_monthly_demand",
        "st_dmax_week",
        "st_max_monthly_demand",
        "st_safety_stock",
        "st_mode_weekly_demand",
        "rol_dynamic",
        "dy_weeks_with_orders",
        "dy_total_sales",
        "dy_avg_weekly_demand",
        "dy_avg_monthly_demand",
        "dy_dmax_week",
        "dy_max_monthly_demand",
        "dy_safety_stock",
        "dy_mode_weekly_demand",
    ]
    for col in col_order:
        if col not in df.columns:  # skip already-added columns
            df[col] = df["Item_Code"].map(lambda ic: metrics[ic].get(col, 0.0))

    return df
