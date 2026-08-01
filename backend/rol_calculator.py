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


def _rol_metrics(d_avg_week: float, d_max_week: float, lead_time: float) -> dict[str, float]:
    """Compute safety stock and reorder level. ROL is always rounded to integer (count of product)."""
    ss = (d_max_week - d_avg_week) * lead_time
    rol_monthly = (d_avg_week * 4) + ss
    return {"rol": float(round(rol_monthly)), "ss": round(ss, 2), "dmax": round(d_max_week, 2)}


# ---------------------------------------------------------------------------
# Per-SKU ROL (single item)
# ---------------------------------------------------------------------------

SENSITIVITY_LEVELS = [0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95]


def compute_rol_sensitivity(
    weekly: pd.DataFrame,
    item_code: str,
    service_levels: list[float] | None = None,
    lead_time: float = DEFAULT_LEAD_TIME_WEEKS,
) -> list[dict[str, float]] | None:
    """Compute Static & Dynamic ROL across a sweep of service levels.

    Used for the "what-if" sensitivity chart on the product detail page —
    X axis = service level, Y axis = ROL, one line per policy. Reuses the
    exact same math as the pipeline (``_rol_metrics_for_series``) so the
    curve always agrees with the numbers in the explorer table.

    Returns ``None`` when the item has no weekly demand records.
    """
    w = weekly[weekly["Item Code"] == item_code]
    if w.empty:
        return None

    levels = service_levels or SENSITIVITY_LEVELS
    total_weeks = _compute_total_weeks(weekly)
    vals = w["Weekly Demand"]
    total_sales = float(vals.sum())

    static_bin = _volume_logic(total_sales)
    mode_of_weekly = int(vals.mode().iloc[0]) if not vals.mode().empty else 0
    if mode_of_weekly <= 0:
        mode_of_weekly = 1

    points: list[dict[str, float]] = []
    for sl in levels:
        static_res = _rol_metrics_for_series(vals, static_bin, total_weeks, sl, lead_time)
        dynamic_res = _rol_metrics_for_series(vals, mode_of_weekly, total_weeks, sl, lead_time)
        points.append(
            {
                "service_level": round(sl, 2),
                "rol_static": static_res["rol"],
                "rol_dynamic": dynamic_res["rol"],
                "dmax_static": static_res["d_max_week"],
                "dmax_dynamic": dynamic_res["d_max_week"],
            }
        )
    return points


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

    return _rol_metrics_for_series(
        w["Weekly Demand"],
        bin_size,
        total_weeks,
        service_level,
        lead_time,
    )


def _rol_metrics_for_series(
    vals: pd.Series,
    bin_size: int,
    total_weeks: int,
    service_level: float,
    lead_time: float,
) -> dict[str, float]:
    """ROL metrics for an already-extracted weekly-demand series.

    Identical math to ``compute_rol_for_item`` but without re-filtering the
    full weekly frame — used by the batch/recompute paths for speed.
    """
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


# Columns produced by the ROL step (dropped & recomputed by recompute_rol_columns)
ROL_COLUMNS = [
    "lead_time",
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


# ---------------------------------------------------------------------------
# Batch ROL for all SKUs in the combined output
# ---------------------------------------------------------------------------

def add_rol_columns(
    final_df: pd.DataFrame,
    weekly: pd.DataFrame,
    service_level: float = DEFAULT_SERVICE_LEVEL,
    lead_time: int = DEFAULT_LEAD_TIME_WEEKS,
    lead_time_map: dict[str, float] | None = None,
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

    # Pre-group weekly demand per item once — avoids repeated O(n) frame scans
    weekly_by_item: dict[str, pd.Series] = {
        ic: g["Weekly Demand"] for ic, g in weekly.groupby("Item Code")
    }

    # Prepare dicts for every metric column
    metrics: dict[str, dict[str, float]] = {ic: {} for ic in item_codes}

    for ic in item_codes:
        m = metrics[ic]
        item_vals = weekly_by_item.get(ic)

        # Use per-SKU lead time from data, fall back to global default
        item_lt = lead_time_map.get(ic, float(lead_time)) if lead_time_map else float(lead_time)
        m["lead_time"] = item_lt

        if item_vals is None or item_vals.empty:
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

        # ----- Static ROL (uses per-SKU lead time, truncated to int like the
        #      original pipeline so recompute never drifts from table values) -----
        static_bin = _volume_logic(item_sales)
        static_res = _rol_metrics_for_series(
            item_vals, static_bin, total_weeks_global, service_level, int(item_lt)
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

        # ----- Dynamic ROL (uses per-SKU lead time, truncated to int) -----
        dynamic_bin = mode_of_weekly
        dynamic_res = _rol_metrics_for_series(
            item_vals, dynamic_bin, total_weeks_global, service_level, int(item_lt)
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
    for col in ROL_COLUMNS:
        if col not in df.columns:  # skip already-added columns
            df[col] = df["Item_Code"].map(lambda ic: metrics[ic].get(col, 0.0))

    return df


def recompute_rol_columns(
    df: pd.DataFrame,
    weekly: pd.DataFrame,
    service_level: float = DEFAULT_SERVICE_LEVEL,
    lead_time: int = DEFAULT_LEAD_TIME_WEEKS,
    lead_time_map: dict[str, float] | None = None,
) -> pd.DataFrame:
    """Recompute only the ROL columns of an existing output with a new service level.

    Drops the ROL columns (``ROL_COLUMNS``) from the input and re-runs
    ``add_rol_columns`` against the cached weekly demand. Segmentation,
    ABC/RFM/Risk and all non-ROL columns are left untouched, so this is a fast
    service-level "what-if" path — the demand planner can apply any value
    without re-running the full pipeline.
    """
    out = df.copy()
    drop = [c for c in ROL_COLUMNS if c in out.columns]
    if drop:
        out = out.drop(columns=drop)
    return add_rol_columns(
        out,
        weekly,
        service_level=service_level,
        lead_time=lead_time,
        lead_time_map=lead_time_map,
    )


# ---------------------------------------------------------------------------
# Step-by-step ROL trace (for the product detail page)
# ---------------------------------------------------------------------------

def _dmax_trace(freq_df: pd.DataFrame, service_level: float) -> dict[str, object]:
    """Describe *how* Dmax was chosen — interpolation vs nearest bucket vs guard.

    Replicates the decision logic (and the rounding guards) of
    ``_compute_dmax`` exactly, returning the actual ``dmax`` used so the
    trace's formula and its result always match the produced numbers.
    """
    below = freq_df[freq_df["Cum Probability"] < service_level]
    if below.empty:
        if len(freq_df) > 1:
            dmax = float(freq_df.iloc[1]["Upper"])
            return {
                "method": "zero-bucket guard",
                "formula": (
                    "Service level falls inside the zero-demand bucket — Dmax = "
                    "first non-zero bucket's Upper"
                ),
                "below": None,
                "above": {"upper": dmax},
                "fraction": None,
                "dmax": dmax,
            }
        return {
            "method": "single bucket",
            "formula": "Only the zero bucket exists",
            "below": None,
            "above": None,
            "fraction": None,
            "dmax": 0.0,
        }

    below_row = below.iloc[-1]
    above = freq_df[freq_df["Cum Probability"] >= service_level]
    if above.empty:
        dmax = float(freq_df.iloc[-1]["Upper"])
        return {
            "method": "last bucket",
            "formula": "Service level exceeds all cumulative probabilities — Dmax = last bucket's Upper",
            "below": {
                "upper": float(below_row["Upper"]),
                "cum_probability": round(float(below_row["Cum Probability"]), 4),
            },
            "above": None,
            "fraction": None,
            "dmax": dmax,
        }

    above_row = above.iloc[0]
    gap = float(above_row["Cum Probability"] - below_row["Cum Probability"])
    if gap > INTERPOLATION_THRESHOLD:
        frac = (service_level - float(below_row["Cum Probability"])) / gap
        dmax = round(below_row["Upper"] + frac * (above_row["Upper"] - below_row["Upper"]))
        # Guard (matches _compute_dmax): don't round down to 0 when demand exists
        if dmax == 0 and above_row["Upper"] > 0:
            dmax = float(above_row["Upper"])
        formula = (
            f"Dmax = {below_row['Upper']:.0f} + ({service_level:.2f} − "
            f"{float(below_row['Cum Probability']):.4f}) / "
            f"({float(above_row['Cum Probability']):.4f} − "
            f"{float(below_row['Cum Probability']):.4f}) × "
            f"({above_row['Upper']:.0f} − {below_row['Upper']:.0f}) = {dmax:.0f}"
        )
        return {
            "method": "interpolation",
            "below": {
                "upper": float(below_row["Upper"]),
                "cum_probability": round(float(below_row["Cum Probability"]), 4),
            },
            "above": {
                "upper": float(above_row["Upper"]),
                "cum_probability": round(float(above_row["Cum Probability"]), 4),
            },
            "fraction": round(float(frac), 4),
            "formula": formula,
            "dmax": dmax,
        }

    # Nearest bucket (gap ≤ threshold) — prefer first non-zero bucket on ties
    probs = freq_df["Cum Probability"].values
    idx = int(np.argmin(np.abs(probs - service_level)))
    selected = float(freq_df.iloc[idx]["Upper"])
    dmax = selected
    if dmax == 0 and len(freq_df) > 1:
        dmax = float(freq_df.iloc[1]["Upper"])
    return {
        "method": "nearest bucket",
        "formula": "Cumulative gap ≤ 5pp → pick the bucket nearest the service level",
        "below": {
            "upper": selected,
            "cum_probability": round(float(freq_df.iloc[idx]["Cum Probability"]), 4),
        },
        "above": None,
        "fraction": None,
        "dmax": dmax,
    }


def _dmax_highlight_uppers(trace: dict[str, object], dmax: float) -> list[int]:
    """Return the Upper value(s) of the frequency-table rows that decide Dmax.

    - interpolation: both bracket rows (below.upper and above.upper)
    - every other method: the single bucket whose Upper equals the resulting Dmax
    """
    if trace.get("method") == "interpolation":
        uppers: list[int] = []
        below = trace.get("below")
        above = trace.get("above")
        if isinstance(below, dict) and below.get("upper") is not None:
            uppers.append(int(below["upper"]))
        if isinstance(above, dict) and above.get("upper") is not None:
            uppers.append(int(above["upper"]))
        return uppers
    return [int(dmax)]


def compute_rol_steps_for_item(
    weekly: pd.DataFrame,
    item_code: str,
    service_level: float = DEFAULT_SERVICE_LEVEL,
    lead_time: float = DEFAULT_LEAD_TIME_WEEKS,
) -> dict[str, object] | None:
    """Build a full step-by-step calculation trace for Static & Dynamic ROL.

    Every step records the formula, the inputs used, and the result, so the
    product detail page can walk a stakeholder through the exact numbers.
    The final ``rol`` values are computed with the exact same helpers as
    ``add_rol_columns``, so the trace always agrees with the pipeline output.

    Returns ``None`` when the item has no weekly demand records.
    """
    w = weekly[weekly["Item Code"] == item_code]
    if w.empty:
        return None

    total_weeks = _compute_total_weeks(weekly)

    # Raw weekly rows (Year, Week, Weekly Demand) — computed once and shared by
    # both Static & Dynamic blocks so users can verify the calculation by hand
    weekly_records = sorted(
        (
            {
                "year": int(r["Year"]),
                "week": int(r["Week"]),
                "demand": float(r["Weekly Demand"]),
            }
            for _, r in w.iterrows()
        ),
        key=lambda r: (r["year"], r["week"]),
    )

    def _volume_reason(bin_size: int) -> str:
        if bin_size == 0:
            return f"Low volume (total sales ≤ {LOW_VOLUME_THRESHOLD}) → bin size 0 → raw mean/max, no frequency distribution"
        if bin_size == MEDIUM_BIN_SIZE:
            return f"Medium volume ({LOW_VOLUME_THRESHOLD} < sales ≤ {MEDIUM_VOLUME_THRESHOLD}) → bin size {MEDIUM_BIN_SIZE}"
        return f"High volume (sales > {MEDIUM_VOLUME_THRESHOLD}) → bin size {HIGH_BIN_SIZE}"

    def _frequency_rows(freq_df: pd.DataFrame) -> list[dict[str, object]]:
        """Return the populated intervals (zero bucket + non-zero) for display."""
        rows: list[dict[str, object]] = []
        for _, r in freq_df.iterrows():
            if r["Lower"] == 0 or int(r["Frequency"]) > 0:
                rows.append(
                    {
                        "lower": int(r["Lower"]),
                        "upper": int(r["Upper"]),
                        "frequency": int(r["Frequency"]),
                        "contribution": round(float(r["Contribution"]), 4),
                        "cum_probability": round(float(r["Cum Probability"]), 4),
                        "mid_point": round(float(r["Mid Point"]), 2),
                        "weighted_sum": round(float(r["Weighted Sum"]), 4),
                    }
                )
        return rows

    def _trace(bin_size: int, bin_reason: str) -> dict[str, object]:
        vals = w["Weekly Demand"]
        total_sales = float(vals.sum())
        weeks_with_orders = int((vals > 0).sum()) if (vals > 0).any() else 0
        steps: list[dict[str, object]] = []

        steps.append(
            {
                "step": 1,
                "title": "Weekly demand records",
                "formula": "Order_Qty aggregated per Item_Code per Year-Week (see source data above)",
                "inputs": {
                    "records": len(w),
                    "weeks_with_orders": weeks_with_orders,
                    "max_weekly_demand": int(vals.max()) if len(vals) else 0,
                },
                "result": f"{len(w)} weeks with recorded demand",
            }
        )
        steps.append(
            {
                "step": 2,
                "title": "Total sales",
                "formula": "Σ Weekly Demand",
                "inputs": {"total_sales": round(total_sales, 2)},
                "result": f"{total_sales:,.2f}",
            }
        )
        steps.append(
            {
                "step": 3,
                "title": "Bin size",
                "formula": "volume_logic(total_sales)",
                "inputs": {"total_sales": round(total_sales, 2)},
                "result": f"{bin_size} — {bin_reason}",
            }
        )

        if bin_size <= 0:
            # No frequency distribution: raw mean / max (service level NOT applied)
            d_avg = float(vals.mean()) if len(vals) else 0.0
            d_max = float(vals.max()) if len(vals) else 0.0
            steps.append(
                {
                    "step": 4,
                    "title": "Average weekly demand",
                    "formula": "mean(Weekly Demand)",
                    "inputs": {},
                    "result": round(d_avg, 2),
                }
            )
            steps.append(
                {
                    "step": 5,
                    "title": "Maximum weekly demand (Dmax)",
                    "formula": "max(Weekly Demand) — raw value; service level NOT applied for bin size 0",
                    "inputs": {},
                    "result": round(d_max, 2),
                }
            )
        else:
            freq_df = _build_frequency_df(vals, bin_size, total_weeks)
            rows = _frequency_rows(freq_df)
            d_avg = float(freq_df["Weighted Sum"].sum())
            trace = _dmax_trace(freq_df, service_level)
            d_max = float(trace["dmax"])
            # Bucket(s) that decide Dmax (the bracket row(s) used by the method).
            dmax_highlight_uppers = _dmax_highlight_uppers(trace, d_max)

            # The frequency table is shown ONCE — at the Frequency distribution
            # step — with the Dmax-deciding bucket(s) color-highlighted, so the
            # client sees every value (Freq / Contrib / Cum Prob / Mid Pt / Wtd
            # Sum) in one place and can verify the Dmax result by eye.
            steps.append(
                {
                    "step": 4,
                    "title": "Frequency distribution",
                    "formula": f"Intervals of size {bin_size} · zero-bucket = total_weeks − non-zero weeks",
                    "inputs": {"total_weeks": total_weeks, "populated_intervals": len(rows)},
                    "result": f"{len(rows)} populated intervals",
                    "frequency_table": rows,
                    "highlight_uppers": dmax_highlight_uppers,
                }
            )

            steps.append(
                {
                    "step": 5,
                    "title": "Average weekly demand",
                    "formula": "Σ (Mid Point × Contribution) — see the Frequency distribution table in step 4",
                    "inputs": {},
                    "result": round(d_avg, 2),
                }
            )
            steps.append(
                {
                    "step": 6,
                    "title": "Dmax at service level",
                    "formula": trace["formula"],
                    "inputs": {"service_level": service_level, "method": trace["method"], "fraction": trace.get("fraction")},
                    "result": round(d_max, 2),
                    "detail": trace,
                }
            )

        avg_monthly = round(d_avg * 4, 2)
        m = _rol_metrics(d_avg, d_max, lead_time)
        steps.append(
            {
                "step": len(steps) + 1,
                "title": "Average monthly demand",
                "formula": "d_avg × 4",
                "inputs": {"d_avg": round(d_avg, 2)},
                "result": avg_monthly,
            }
        )
        steps.append(
            {
                "step": len(steps) + 1,
                "title": "Safety stock",
                "formula": "(Dmax − d_avg) × lead_time",
                "inputs": {"dmax": round(d_max, 2), "d_avg": round(d_avg, 2), "lead_time": lead_time},
                "result": m["ss"],
            }
        )
        steps.append(
            {
                "step": len(steps) + 1,
                "title": "Reorder level (ROL)",
                "formula": "avg_monthly + safety_stock",
                "inputs": {"avg_monthly": avg_monthly, "safety_stock": m["ss"]},
                "result": m["rol"],
            }
        )
        return {
            "bin_size": bin_size,
            "reason": bin_reason,
            "result": {
                "rol": m["rol"],
                "safety_stock": m["ss"],
                "d_avg_week": round(d_avg, 2),
                "d_max_week": round(d_max, 2),
            },
            "steps": steps,
        }

    vals = w["Weekly Demand"]
    total_sales = float(vals.sum())
    static_bin = _volume_logic(total_sales)
    mode_of_weekly = int(vals.mode().iloc[0]) if not vals.mode().empty else 0
    if mode_of_weekly <= 0:
        mode_of_weekly = 1

    return {
        "item_code": item_code,
        "service_level": service_level,
        "lead_time": lead_time,
        "total_weeks": total_weeks,
        "static": _trace(static_bin, _volume_reason(static_bin)),
        "dynamic": _trace(mode_of_weekly, f"Mode of weekly demand = {mode_of_weekly}"),
        "weekly_records": weekly_records,
    }
