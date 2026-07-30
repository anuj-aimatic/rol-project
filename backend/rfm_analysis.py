"""SKU-level RFM analysis: Recency, Frequency, Monetary scoring."""

from __future__ import annotations

import pandas as pd

from backend.config import RFM_QUANTILES


def _score_col(series: pd.Series, ascending: bool) -> pd.Series:
    """Quantile score 1..N where higher=better.

    If ascending=True, higher raw value gets higher score (Frequency, Monetary).
    If ascending=False, lower raw value gets higher score (Recency).
    """
    labels = list(range(1, RFM_QUANTILES + 1))
    if not ascending:
        labels = list(reversed(labels))
    n = series.nunique()
    if n >= RFM_QUANTILES:
        return pd.qcut(series.rank(method="first"), q=RFM_QUANTILES, labels=labels).astype(int)
    # Fallback: fewer unique values than quantiles
    return series.rank(method="first", ascending=ascending).astype(int)


def _classify_rfm(r: int, f: int) -> str:
    """Classify into Runner/Repeater/Dormant/Slow Mover based on R and F scores."""
    if r >= 4 and f >= 4:
        return "Runner"
    if r >= 3 and f >= 3:
        return "Repeater"
    if r <= 2 and f <= 2:
        return "Dormant"
    return "Slow Mover"


def run_rfm(df: pd.DataFrame) -> pd.DataFrame:
    """Compute SKU-level RFM features from order intake data.

    Parameters
    ----------
    df : pd.DataFrame
        Must contain 'Item_Code', 'Party_Code', 'Order_Amount', 'OriginalOA_Date'.

    Returns
    -------
    pd.DataFrame
        One row per SKU with columns:
        Item_Code, Recency, Frequency, Monetary, Unique_Customer_Count,
        R_Score, F_Score, M_Score, RFM_Score, RFM_Category
    """
    now = df["OriginalOA_Date"].max()

    rfm = (
        df.groupby("Item_Code")
        .agg(
            Recency=("OriginalOA_Date", lambda x: (now - x.max()).days),
            Frequency=("Item_Code", "count"),
            Monetary=("Order_Amount", "sum"),
            Unique_Customer_Count=("Party_Code", "nunique"),
        )
        .reset_index()
    )

    rfm["R_Score"] = _score_col(rfm["Recency"], ascending=False)
    rfm["F_Score"] = _score_col(rfm["Frequency"], ascending=True)
    rfm["M_Score"] = _score_col(rfm["Monetary"], ascending=True)

    # RFM_Score = concatenation of R+F+M scores
    rfm["RFM_Score"] = (
        rfm["R_Score"].astype(str)
        + rfm["F_Score"].astype(str)
        + rfm["M_Score"].astype(str)
    ).astype(int)

    rfm["RFM_Category"] = rfm.apply(lambda r: _classify_rfm(r["R_Score"], r["F_Score"]), axis=1)

    return rfm
