"""Data loading functions — Order Intake + FG Stock export.

Both the segmentation (ABC/RFM/Risk) AND the ROL calculation derive
their data from the same Order Intake file, ensuring Item_Code
consistency across all stages. The FG Stock export is merged on
Item_Code to enrich the product table with open-stock valuation.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from backend.config import DEFAULT_FG_STOCK_FILE, DEFAULT_FG_STOCK_SHEET


def load_fg_stock(
    file_path: str | Path = DEFAULT_FG_STOCK_FILE,
    sheet_name: str | int | None = None,
) -> pd.DataFrame:
    """Load the FG Stock export and return Item_Code + Open FG Stock.

    Parameters
    ----------
    file_path : str | Path
        Path to the FG Stock Excel file.
    sheet_name : str | int | None
        Sheet to read; defaults to ``DEFAULT_FG_STOCK_SHEET`` and falls
        back to the first sheet if that name is absent.

    Returns
    -------
    pd.DataFrame
        Two-column frame (``Item_Code``, ``Open FG Stock``). Unmatched
        SKUs get ``Open FG Stock = 0`` downstream at merge time.
    """
    # Resolve the sheet to read: configured name first, else first sheet
    sheet = sheet_name
    if sheet is None:
        xl = pd.ExcelFile(file_path)
        if DEFAULT_FG_STOCK_SHEET in xl.sheet_names:
            sheet = DEFAULT_FG_STOCK_SHEET
        elif xl.sheet_names:
            sheet = xl.sheet_names[0]
    df = pd.read_excel(file_path, sheet_name=sheet)

    cols = {str(c).strip(): c for c in df.columns}
    item_col = cols.get("Item_Code")
    stock_col = cols.get("Open FG Stock")
    if item_col is None or stock_col is None:
        raise ValueError(
            f"FG Stock file must contain 'Item_Code' and 'Open FG Stock' columns; got {list(df.columns)}"
        )

    out = pd.DataFrame({"Item_Code": df[item_col], "Open FG Stock": pd.to_numeric(df[stock_col], errors="coerce")})
    out = out.dropna(subset=["Item_Code"])
    # Aggregate duplicates (defensive — a SKU should appear once, but sum if not)
    out = out.groupby("Item_Code", as_index=False)["Open FG Stock"].sum()
    out["Item_Code"] = out["Item_Code"].astype(str).str.strip()
    return out


def load_order_intake(
    file_path: str | Path,
    sheet_name: str = "M1",
    dedupe_orders: bool = True,
) -> pd.DataFrame:
    """Load an Order Intake Excel sheet with date parsing + order-line dedup.

    Parameters
    ----------
    file_path : str | Path
        Path to the Excel file.
    sheet_name : str
        Sheet name to read (default ``"M1"``; also ``"M2&H2"``).
    dedupe_orders : bool
        Collapse repeated order lines. Rows that share the same customer
        (``Party_Code``), order number (``OA_No``), order date
        (``OriginalOA_Date``) and SKU (``Item_Code``) represent **one** order,
        not several — e.g. a single OA_No exported once per SKU line is
        duplicated 10x in the raw export. Keeping only the first occurrence
        prevents inflated Frequency, weekly demand (and therefore ROL), and
        Monetary values. Default ``True``.

    Handles both Excel serial numbers and ISO date strings in
    ``OriginalOA_Date``.
    """
    df = pd.read_excel(file_path, sheet_name=sheet_name, dtype={"OriginalOA_Date": object})

    def _parse_date(val: Any) -> pd.Timestamp:
        if isinstance(val, (int, float)):
            return pd.Timestamp("1899-12-30") + pd.to_timedelta(int(val), unit="D")
        return pd.to_datetime(val)

    df["OriginalOA_Date"] = df["OriginalOA_Date"].apply(_parse_date)

    if dedupe_orders:
        n_before = len(df)
        df = df.drop_duplicates(
            subset=["Party_Code", "OA_No", "OriginalOA_Date", "Item_Code"],
            keep="first",
        ).reset_index(drop=True)
        if n_before != len(df):
            print(
                f"       Order-line dedup: {n_before} -> {len(df)} rows "
                "(same customer + OA_No + date + SKU counts as one order)"
            )

    return df
