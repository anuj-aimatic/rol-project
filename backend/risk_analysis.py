"""Product-group-level risk analysis based on customer concentration."""

from __future__ import annotations

import pandas as pd

from backend.config import INTERNAL_PARTY_CODES


def _classify_risk(concentration: float, customer_type: str) -> str:
    """Classify risk for a product group."""
    if customer_type == "External":
        if concentration >= 80:
            return "High_Risk_External"
        if concentration >= 60:
            return "Medium_Risk_External"
        return "Low_Risk_External"
    # Internal customers are capped at Medium Risk
    if concentration >= 60:
        return "Medium_Risk_Internal"
    return "Low_Risk_Internal"


def compute_product_risk(df: pd.DataFrame) -> pd.DataFrame:
    """Compute Risk_Category for each Product Group Code.

    Steps:
      1. Aggregate customer-wise sales per product group.
      2. Tag each customer as Internal or External.
      3. Compute concentration as (largest customer sales / total sales).
      4. Classify risk using concentration thresholds.

    Parameters
    ----------
    df : pd.DataFrame
        Must contain 'Product Group Code', 'Party_Code', 'Order_Amount'.

    Returns
    -------
    pd.DataFrame
        Columns: ['Product Group Code', 'Risk_Category']
    """
    # Customer-wise sales per product group
    grp_cust = (
        df.groupby(["Product Group Code", "Party_Code"], as_index=False)["Order_Amount"]
        .sum()
        .rename(columns={"Order_Amount": "Cust_Sales"})
    )

    # Tag customer type
    grp_cust["Cust_Type"] = grp_cust["Party_Code"].apply(
        lambda c: "Internal" if c in INTERNAL_PARTY_CODES else "External"
    )

    # Largest customer per product group
    idx = grp_cust.groupby("Product Group Code")["Cust_Sales"].idxmax()
    largest = grp_cust.loc[idx, ["Product Group Code", "Cust_Type", "Cust_Sales"]].rename(
        columns={"Cust_Sales": "Largest_Sales", "Cust_Type": "Largest_Type"}
    )

    # Total sales per product group
    total = grp_cust.groupby("Product Group Code", as_index=False)["Cust_Sales"].sum().rename(
        columns={"Cust_Sales": "Total_Sales"}
    )

    # Merge
    merged = total.merge(largest, on="Product Group Code", how="left")

    # Concentration %
    merged["Concentration"] = (merged["Largest_Sales"] / merged["Total_Sales"] * 100).round(2)

    # Classification
    merged["Risk_Category"] = merged.apply(
        lambda r: _classify_risk(r["Concentration"], r["Largest_Type"]), axis=1
    )

    return merged[["Product Group Code", "Risk_Category"]]
