"""Data loading functions — currently only Order Intake data is needed.

Both the segmentation (ABC/RFM/Risk) AND the ROL calculation derive
their data from the same Order Intake file, ensuring Item_Code
consistency across all stages.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd


def load_order_intake(
    file_path: str | Path,
    sheet_name: str = "M1",
) -> pd.DataFrame:
    """Load an Order Intake Excel sheet with date parsing.

    Parameters
    ----------
    file_path : str | Path
        Path to the Excel file.
    sheet_name : str
        Sheet name to read (default ``"M1"``; also ``"M2&H2"``).

    Handles both Excel serial numbers and ISO date strings in
    ``OriginalOA_Date``.
    """
    df = pd.read_excel(file_path, sheet_name=sheet_name, dtype={"OriginalOA_Date": object})

    def _parse_date(val: Any) -> pd.Timestamp:
        if isinstance(val, (int, float)):
            return pd.Timestamp("1899-12-30") + pd.to_timedelta(int(val), unit="D")
        return pd.to_datetime(val)

    df["OriginalOA_Date"] = df["OriginalOA_Date"].apply(_parse_date)
    return df
