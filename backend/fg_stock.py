"""FG Stock enrichment — open stock valuation, deficit, and coverage columns.

Maps the FG Stock export (keyed on ``Item_Code``) onto the ROL pipeline
output and derives the valuation / deficit / coverage columns that feed the
"Product Table" in the Inventory Explorer.

All columns depend only on existing pipeline columns (``rol_static``,
``rol_dynamic``, ``Monetary``, ``st_total_sales``, ``dy_total_sales``,
``st_avg_monthly_demand``, ``dy_avg_monthly_demand``) plus the mapped
``Open FG Stock``, so the whole block can be recomputed any time the ROL
service level changes (``/recompute-rol``).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from backend.config import UNIT_COST_FACTOR
from backend.data_loader import load_fg_stock

# Columns added by this module (dropped & recomputed by add_fg_stock_columns
# so a service-level recompute never leaves stale values behind).
FG_STOCK_COLUMNS = [
    "Open FG Stock",
    "Deficiate Static Stock",
    "Deficiate Dynamic Stock",
    "Unit Cost at 65 percent",
    "Stock Cost",
    "Static Deficiate Cost",
    "Dynamic Deficiate Cost",
    "Inventory Turnover Month (Static)",
    "Inventory Turnover Month (Dynamic)",
]

# Previous column names from earlier versions — dropped too so cached results
# (e.g. from before the st/dy merge) never keep stale duplicates around.
LEGACY_FG_STOCK_COLUMNS = [
    "Unit Cost at 65 percent (Static)",
    "Unit Cost at 65 percent (Dynamic)",
    "Static Stock Cost",
    "Dynamic Stock Cost",
    "Static Inventory Coverage (Weeks)",
    "Dynamic Inventory Coverage (Weeks)",
]


def _safe_div(num: pd.Series, den: pd.Series) -> pd.Series:
    """Element-wise division treating 0 denominators as NaN (no warnings)."""
    with np.errstate(divide="ignore", invalid="ignore"):
        return pd.Series(np.divide(num, den), index=num.index)


def enrich_with_fg_stock(
    df: pd.DataFrame,
    fg_stock: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Load the FG Stock file (best-effort) and add the valuation columns.

    ``fg_stock`` may be a preloaded frame — e.g. an uploaded export parsed by
    :func:`backend.data_loader.load_fg_stock` — which takes precedence over the
    default file. When ``None`` and the default FG Stock file is missing (e.g.
    an environment without the local ``data/`` folder), every SKU falls back
    to ``Open FG Stock = 0`` instead of failing.
    """
    if fg_stock is None:
        try:
            fg_stock = load_fg_stock()
            print(f"       FG Stock: {len(fg_stock)} SKUs mapped")
        except FileNotFoundError:
            print(
                "       FG Stock file not found — Open FG Stock = 0 for all SKUs "
                "(all valuation/deficit columns are computed from zero)"
            )
            fg_stock = None
    else:
        print(f"       FG Stock: {len(fg_stock)} SKUs mapped (uploaded export)")
    return add_fg_stock_columns(df, fg_stock)


def add_fg_stock_columns(
    df: pd.DataFrame,
    fg_stock: pd.DataFrame | None,
) -> pd.DataFrame:
    """Merge open FG stock and append the 9 valuation columns.

    Parameters
    ----------
    df : pd.DataFrame
        Pipeline output containing ``Item_Code`` plus the ROL/metric columns.
    fg_stock : pd.DataFrame | None
        Frame with ``Item_Code`` + ``Open FG Stock`` from
        :func:`backend.data_loader.load_fg_stock`. ``None`` (or empty) maps
        every SKU to ``Open FG Stock = 0``.

    Returns
    -------
    pd.DataFrame
        Copy of ``df`` with the ``FG_STOCK_COLUMNS`` columns set/recomputed.

    Notes
    -----
    * ``Open FG Stock`` defaults to 0 for SKUs with no match in the FG file,
      and **negative values are clamped to 0** (a negative open stock is
      treated as no stock on hand — per the requested rule).
    * ``Unit Cost at 65 percent`` and ``Stock Cost`` are single columns — the
      static/dynamic variants were identical (same total sales), so only one
      is kept.
    * ``Stock Cost`` is zeroed when ``Open FG Stock < 0`` (defensive — the
      clamp above already guarantees non-negative stock); deficit costs are
      absolute values.
    * ``Inventory Turnover Month`` is ``rol / avg_monthly_demand`` — how many
      months of forward demand the ROL covers. Undefined when monthly demand
      is 0, which becomes ``NaN`` for explicit display.
    """
    out = df.copy()
    for col in FG_STOCK_COLUMNS + LEGACY_FG_STOCK_COLUMNS:
        if col in out.columns:
            out = out.drop(columns=[col])

    # ---- Step 1-2: merge Open FG Stock on Item_Code (0 when unmatched) ----
    if fg_stock is not None and not fg_stock.empty:
        fg = fg_stock.copy()
        fg["Item_Code"] = fg["Item_Code"].astype(str).str.strip()
        key = out["Item_Code"].astype(str).str.strip()
        stock = key.map(fg.set_index("Item_Code")["Open FG Stock"]).fillna(0.0)
        # Negative open stock is treated as 0 (no stock on hand)
        out["Open FG Stock"] = stock.clip(lower=0.0)
    else:
        out["Open FG Stock"] = 0.0

    rol_static = out["rol_static"]
    rol_dynamic = out["rol_dynamic"]
    monetary = out["Monetary"]
    st_sales = out["st_total_sales"]

    # ---- Steps 4-5: deficit (ROL minus open stock) ----
    out["Deficiate Static Stock"] = rol_static - out["Open FG Stock"]
    out["Deficiate Dynamic Stock"] = rol_dynamic - out["Open FG Stock"]

    # ---- Step 6: unit cost = (Monetary / total_sales) * 65% (single) ----
    out["Unit Cost at 65 percent"] = _safe_div(monetary, st_sales) * UNIT_COST_FACTOR

    # ---- Step 8: stock cost = IF(Open FG Stock < 0, 0, stock * unit cost) ----
    open_stock = out["Open FG Stock"]
    out["Stock Cost"] = np.where(
        open_stock < 0, 0.0, open_stock * out["Unit Cost at 65 percent"]
    )

    # ---- Steps 10-11: deficit cost = ABS(deficit * unit cost) ----
    out["Static Deficiate Cost"] = (
        out["Deficiate Static Stock"] * out["Unit Cost at 65 percent"]
    ).abs()
    out["Dynamic Deficiate Cost"] = (
        out["Deficiate Dynamic Stock"] * out["Unit Cost at 65 percent"]
    ).abs()

    # ---- Steps 12-13: inventory turnover in months = rol / avg monthly demand ----
    out["Inventory Turnover Month (Static)"] = _safe_div(
        rol_static, out["st_avg_monthly_demand"]
    )
    out["Inventory Turnover Month (Dynamic)"] = _safe_div(
        rol_dynamic, out["dy_avg_monthly_demand"]
    )

    return out
