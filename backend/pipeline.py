"""End-to-end pipeline: ABC + RFM + Risk combined at SKU level, then ROL from intake data.

Produces a single CSV matching the structure of ``sheet_m2h2_sku_final_abc_rfm_risk.csv``
with two extra columns: ``rol_static`` and ``rol_dynamic``.

All data (segmentation + ROL) comes from the **same** Order Intake Excel file,
ensuring Item_Code consistency across every stage.
"""

from __future__ import annotations

import pandas as pd

from backend.config import DEFAULT_INTAKE_FILE, DEFAULT_INTAKE_SHEET
from backend.data_loader import load_order_intake
from backend.risk_analysis import compute_product_risk
from backend.hierarchical_abc import run_hierarchical_abc
from backend.rfm_analysis import run_rfm
from backend.rol_calculator import add_rol_columns


def _build_weekly_from_intake(df: pd.DataFrame) -> pd.DataFrame:
    """Aggregate weekly demand (sum of Order_Qty) per SKU from order intake data."""
    dd = df.copy()
    dd["Year"] = dd["OriginalOA_Date"].dt.isocalendar().year.astype(int)
    dd["Week"] = dd["OriginalOA_Date"].dt.isocalendar().week.astype(int)
    weekly = (
        dd.groupby(["Item_Code", "Year", "Week"], as_index=False)["Order_Qty"]
        .sum()
        .rename(columns={"Order_Qty": "Weekly Demand", "Item_Code": "Item Code"})
    )
    return weekly


def run_pipeline(
    intake_path: str = DEFAULT_INTAKE_FILE,
    intake_sheet: str = DEFAULT_INTAKE_SHEET,
    service_level: float = 0.85,
    lead_time: int = 4,
    output_path: str | None = None,
) -> pd.DataFrame:
    """Run the full ABC-RFM-Risk-ROL pipeline using a single Order Intake file.

    Parameters
    ----------
    intake_path : str
        Path to the Order Intake Excel (notebook/Order Intake Incl Amounts.xlsx).
    intake_sheet : str
        Sheet name to use (``"M1"`` or ``"M2&H2"``).
    service_level : float
        Service level for ROL (default 0.85).
    lead_time : int
        Lead time in weeks (default 4).
    output_path : str, optional
        If provided, saves the final CSV to this path.

    Returns
    -------
    pd.DataFrame
        Combined SKU-level DataFrame with ABC, RFM, Risk, and ROL columns.
    """
    # ---- Step 1: Load Order Intake (single source for everything) ----
    print(f"[1/6] Loading Order Intake data (sheet: {intake_sheet})...")
    intake = load_order_intake(intake_path, sheet_name=intake_sheet)
    print(f"       {len(intake)} rows, {len(intake.columns)} columns")

    # ---- Step 2: Product Group Risk ----
    print("[2/6] Computing product group risk...")
    risk = compute_product_risk(intake)
    print(f"       {len(risk)} product groups classified")

    # ---- Step 3: Hierarchical ABC ----
    print("[3/6] Running hierarchical ABC (Category->Group->SubGroup->SKU)...")
    abc_cols = [
        "Item_Category_Code", "Product Group Code", "Product_SubGroup_Code",
        "Item_Code", "Item_Name", "Order_Amount",
    ]
    abc_input = intake[abc_cols].copy()
    abc = run_hierarchical_abc(abc_input)
    print(f"       {len(abc)} SKUs classified (ABC)")

    # ---- Step 4: SKU-level RFM ----
    print("[4/6] Running SKU-level RFM...")
    rfm = run_rfm(intake)
    print(f"       {len(rfm)} SKUs classified (RFM)")

    # ---- Step 5: Merge into combined DataFrame ----
    print("[5/6] Merging ABC + RFM + Risk at SKU level...")

    combined = abc.merge(rfm, on="Item_Code", how="left", suffixes=("", "_rfm"))
    combined = combined.merge(risk, on="Product Group Code", how="left")

    # Compute mode_order_qty per SKU from intake data
    print("       Computing mode_order_qty per SKU...")
    mode_qty = (
        intake.groupby("Item_Code")["Order_Qty"]
        .agg(lambda s: s.mode().iloc[0] if not s.mode().empty else 0)
        .rename("mode_order_qty")
        .reset_index()
    )
    mode_qty["mode_valid"] = mode_qty["mode_order_qty"] > 0
    combined = combined.merge(mode_qty, on="Item_Code", how="left")

    # Build final columns matching target CSV structure
    final = pd.DataFrame()
    final["Item_Category_Code"] = combined["Item_Category_Code"]
    final["Recency"] = combined["Recency"]
    final["Frequency"] = combined["Frequency"]
    final["Monetary"] = combined["Monetary"]
    final["Unique_Customer_Count"] = combined["Unique_Customer_Count"]
    final["R_Score"] = combined["R_Score"]
    final["F_Score"] = combined["F_Score"]
    final["M_Score"] = combined["M_Score"]
    final["RFM_Score"] = combined["RFM_Score"]
    final["RFM_Category"] = combined["RFM_Category"]
    final["Entity_Code"] = combined["Item_Code"]
    final["Level"] = "SKU"
    final["Product Group Code"] = combined["Product Group Code"]
    final["Product_SubGroup_Code"] = combined["Product_SubGroup_Code"]
    final["Item_Code"] = combined["Item_Code"]
    final["ABC_Class"] = combined["ABC_Class"]
    final["ABC_Quantum"] = combined["ABC_Quantum"]
    final["Contribution (%)"] = combined["Contribution (%)"]
    final["Cumulative Contribution (%)"] = combined["Cumulative Contribution (%)"]
    final["Risk_Category"] = combined["Risk_Category"]
    final["mode_order_qty"] = combined["mode_order_qty"]
    final["mode_valid"] = combined["mode_valid"]

    print(f"       Combined: {len(final)} SKU rows")

    # ---- Step 6: Build weekly demand from the SAME intake data and compute ROL ----
    print("[6/6] Computing ROL (static & dynamic) from intake data...")
    weekly = _build_weekly_from_intake(intake)
    print(f"       Weekly demand records: {len(weekly)}")

    final = add_rol_columns(final, weekly, service_level=service_level, lead_time=lead_time)

    print(f"       Done! {len(final)} rows, {len(final.columns)} columns")

    if output_path:
        final.to_csv(output_path, index=False)
        print(f"       Saved to: {output_path}")

    return final
