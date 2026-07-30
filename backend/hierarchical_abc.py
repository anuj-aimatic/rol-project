"""Hierarchical ABC analysis: Category -> Group -> SubGroup -> SKU."""

from __future__ import annotations

import pandas as pd


def _abc_classify(summary: pd.DataFrame) -> pd.DataFrame:
    """Apply Pareto ABC (A:80%, B:95%, C:rest) to a sorted summary."""
    summary = summary.sort_values("Total_Order_Amount", ascending=False).reset_index(drop=True)
    total = summary["Total_Order_Amount"].sum()
    summary["Contribution (%)"] = (summary["Total_Order_Amount"] / total * 100) if total > 0 else 0.0
    summary["Cumulative Contribution (%)"] = summary["Contribution (%)"].cumsum()

    def _cls(cum: float) -> str:
        if cum <= 80:
            return "A"
        if cum <= 95:
            return "B"
        return "C"

    summary["ABC_Class"] = summary["Cumulative Contribution (%)"].apply(_cls)
    return summary


def run_hierarchical_abc(data: pd.DataFrame) -> pd.DataFrame:
    """Run hierarchical ABC and return SKU-level results.

    Hierarchy: Item_Category_Code >> Product Group Code >> Product_SubGroup_Code >> Item_Code
    Each child level is classified within its parent.

    Output columns (per SKU row):
      Item_Category_Code, Product Group Code, Product_SubGroup_Code,
      Item_Code, Item_Name, ABC_Class, ABC_Quantum (total amount),
      Contribution (%), Cumulative Contribution (%),
      Category_ABC, Product_Group_ABC, Product_SubGroup_ABC
    """
    results: list[pd.DataFrame] = []

    # Level 1: Category
    cat_summary = (
        data.groupby("Item_Category_Code", as_index=False)["Order_Amount"]
        .sum()
        .rename(columns={"Order_Amount": "Total_Order_Amount"})
    )
    cat_summary = _abc_classify(cat_summary)

    for _, cat_row in cat_summary.iterrows():
        cat = cat_row["Item_Category_Code"]
        cat_data = data[data["Item_Category_Code"] == cat]

        # Level 2: Product Group
        grp_summary = (
            cat_data.groupby("Product Group Code", as_index=False)["Order_Amount"]
            .sum()
            .rename(columns={"Order_Amount": "Total_Order_Amount"})
        )
        grp_summary = _abc_classify(grp_summary)

        for _, grp_row in grp_summary.iterrows():
            grp = grp_row["Product Group Code"]
            grp_data = cat_data[cat_data["Product Group Code"] == grp]

            # Level 3: SubGroup
            sub_summary = (
                grp_data.groupby("Product_SubGroup_Code", as_index=False)["Order_Amount"]
                .sum()
                .rename(columns={"Order_Amount": "Total_Order_Amount"})
            )
            sub_summary = _abc_classify(sub_summary)

            for _, sub_row in sub_summary.iterrows():
                sub = sub_row["Product_SubGroup_Code"]
                sub_data = grp_data[grp_data["Product_SubGroup_Code"] == sub]

                # Level 4: SKU
                sku_summary = (
                    sub_data.groupby(["Item_Code", "Item_Name"], as_index=False)["Order_Amount"]
                    .sum()
                    .rename(columns={"Order_Amount": "Total_Order_Amount"})
                )
                sku_summary = _abc_classify(sku_summary)

                sku_summary["Item_Category_Code"] = cat
                sku_summary["Category_ABC"] = cat_row["ABC_Class"]
                sku_summary["Product Group Code"] = grp
                sku_summary["Product_Group_ABC"] = grp_row["ABC_Class"]
                sku_summary["Product_SubGroup_Code"] = sub
                sku_summary["Product_SubGroup_ABC"] = sub_row["ABC_Class"]

                results.append(sku_summary)

    final = pd.concat(results, ignore_index=True)
    # Rename Total_Order_Amount to ABC_Quantum for final output
    final = final.rename(columns={"Total_Order_Amount": "ABC_Quantum"})
    return final
