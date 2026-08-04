"""Customer-level analytics from Order Intake data.

Computes portfolio summaries, concentration (Pareto), top products per customer,
category preferences, and key KPIs for the CEO-level Customer Analytics page.
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from backend.config import INTERNAL_PARTY_CODES


def _tag_internal(party_code: str) -> str:
    """Return 'Internal' or 'External' based on the master list."""
    return "Internal" if party_code in INTERNAL_PARTY_CODES else "External"


def _classify_customer_risk(summary: dict[str, Any]) -> str:
    """Classify a customer's risk level based on key metrics.

    Factors considered:
      - recency_days: how long since last order (shorter = lower risk)
      - order_count: how many orders placed (more = lower risk)
      - unique_products: diversification (more = lower risk)
      - customer_type: Internal customers are capped at Medium
      - avg_order_value trend
    """
    recency = summary.get("recency_days", 999)
    orders = summary.get("order_count", 0)
    products = summary.get("unique_products", 0)
    ctype = summary.get("customer_type", "External")

    # Score-based system (lower = riskier)
    score = 0
    # Recency: > 365 days is very risky
    if recency <= 30:
        score += 3
    elif recency <= 90:
        score += 2
    elif recency <= 180:
        score += 1
    # Order frequency
    if orders >= 10:
        score += 3
    elif orders >= 5:
        score += 2
    elif orders >= 2:
        score += 1
    # Product diversification
    if products >= 5:
        score += 3
    elif products >= 3:
        score += 2
    elif products >= 2:
        score += 1

    # Classify
    if ctype == "Internal":
        if score <= 3:
            return "Medium_Risk_Internal"
        return "Low_Risk_Internal"
    # External
    if score <= 2:
        return "High_Risk_External"
    if score <= 4:
        return "Medium_Risk_External"
    return "Low_Risk_External"


def compute_customer_portfolio(df: pd.DataFrame) -> pd.DataFrame:
    """Build a per-customer summary DataFrame.

    For each ``Party_Code`` computes:
      - total_revenue, order_count, unique_products
      - avg_order_value, first_order_date, last_order_date
      - recency_days (days since last order from dataset max date)
      - customer_type (Internal / External)
      - top_category (the Item_Category_Code with highest revenue)
      - top_category_revenue

    Parameters
    ----------
    df : pd.DataFrame
        Order Intake with columns ``Party_Code``, ``Order_Amount``,
        ``OriginalOA_Date``, ``Item_Code``, ``Item_Category_Code``.

    Returns
    -------
    pd.DataFrame
        One row per customer.
    """
    # Per-customer aggregates
    portfolio = (
        df.groupby("Party_Code", as_index=False)
        .agg(
            total_revenue=("Order_Amount", "sum"),
            order_count=("OA_No", "nunique"),
            unique_products=("Item_Code", "nunique"),
            first_order_date=("OriginalOA_Date", "min"),
            last_order_date=("OriginalOA_Date", "max"),
        )
    )

    # Recency in days from the latest order in the whole dataset
    max_date = df["OriginalOA_Date"].max()
    portfolio["recency_days"] = (max_date - portfolio["last_order_date"]).dt.days

    # Average order value
    portfolio["avg_order_value"] = (
        portfolio["total_revenue"] / portfolio["order_count"]
    ).round(2)

    # Internal / External classification
    portfolio["customer_type"] = portfolio["Party_Code"].apply(_tag_internal)

    # Top category per customer (by revenue)
    cat_rev = (
        df.groupby(["Party_Code", "Item_Category_Code"], as_index=False)["Order_Amount"]
        .sum()
        .rename(columns={"Order_Amount": "cat_revenue"})
    )
    idx = cat_rev.groupby("Party_Code")["cat_revenue"].idxmax()
    top_cats = cat_rev.loc[idx, ["Party_Code", "Item_Category_Code", "cat_revenue"]].rename(
        columns={"Item_Category_Code": "top_category", "cat_revenue": "top_category_revenue"}
    )
    portfolio = portfolio.merge(top_cats, on="Party_Code", how="left")

    # Per-customer dimension coverage for filtering
    cust_dims = (
        df.groupby("Party_Code")
        .agg(
            categories_bought=("Item_Category_Code", lambda s: sorted(s.unique().tolist())),
            product_groups_bought=("Product Group Code", lambda s: sorted(s.dropna().unique().tolist())),
            sub_groups_bought=("Product_SubGroup_Code", lambda s: sorted(s.dropna().unique().tolist())),
        )
        .reset_index()
    )
    # Convert numeric types to strings for JSON
    cust_dims["product_groups_bought"] = cust_dims["product_groups_bought"].apply(
        lambda lst: [str(x) for x in lst]
    )
    cust_dims["sub_groups_bought"] = cust_dims["sub_groups_bought"].apply(
        lambda lst: [str(x) for x in lst]
    )
    portfolio = portfolio.merge(cust_dims, on="Party_Code", how="left")

    # Sort by revenue descending
    portfolio = portfolio.sort_values("total_revenue", ascending=False).reset_index(drop=True)

    return portfolio


def compute_customer_risk_distribution(
    portfolio: pd.DataFrame,
) -> list[dict[str, Any]]:
    """Add risk category to each customer in the portfolio and return distribution counts."""
    records = portfolio.to_dict(orient="records")
    for r in records:
        r["customer_risk"] = _classify_customer_risk(r)
    # Count distribution
    from collections import Counter
    counts = Counter(r["customer_risk"] for r in records)
    return [
        {"category": cat, "count": cnt}
        for cat, cnt in sorted(counts.items(), key=lambda x: -x[1])
    ]


def compute_multi_product_sankey(
    df: pd.DataFrame,
    top_customers: int = 10,
    top_groups: int = 8,
    items_per_group: int = 3,
) -> dict[str, Any]:
    """Build 3-level Sankey flow data: Customer --> Product Group --> Item (SKU).

    Unlike the previous version that took the top N items globally (which could
    all belong to just 1-2 groups), this version ensures every product group in
    the middle layer has items flowing through it.

    Strategy:
      1. Take top ``top_customers`` customers by revenue.
      2. For those customers, find the top ``top_groups`` product groups by revenue.
      3. Within each of those groups, take the top ``items_per_group`` items.

    Returns a dict with ``labels``, ``source``, ``target``, ``value`` arrays
    for a Plotly Sankey trace.
    """
    from collections import defaultdict

    # ---- Top N customers by revenue ----
    top_cust = (
        df.groupby("Party_Code", as_index=False)["Order_Amount"]
        .sum()
        .sort_values("Order_Amount", ascending=False)
        .head(top_customers)
    )["Party_Code"].tolist()

    sub = df[df["Party_Code"].isin(top_cust)].copy()

    # ---- Top product groups by revenue (from these customers) ----
    group_rev = (
        sub.groupby("Product Group Code", as_index=False)["Order_Amount"]
        .sum()
        .sort_values("Order_Amount", ascending=False)
        .head(top_groups)
    )
    top_group_codes = set(group_rev["Product Group Code"].tolist())

    # Keep only rows in those groups
    sub_in_groups = sub[sub["Product Group Code"].isin(top_group_codes)]

    # ---- For each product group, take top items ----
    # Collect which items to keep (per group)
    kept_items: set[str] = set()
    group_item_flow: defaultdict = defaultdict(float)
    cust_to_group: defaultdict = defaultdict(float)

    for gcode in top_group_codes:
        gcode_str = str(gcode)
        grp_rows = sub_in_groups[sub_in_groups["Product Group Code"] == gcode]
        # Top items in this group
        top_items_in_group = (
            grp_rows.groupby("Item_Code", as_index=False)["Order_Amount"]
            .sum()
            .sort_values("Order_Amount", ascending=False)
            .head(items_per_group)
        )
        for _, irow in top_items_in_group.iterrows():
            item_code = irow["Item_Code"]
            kept_items.add(item_code)
            # Sum group → item amount from ALL rows (not just this group's filter)
            mask = sub_in_groups["Item_Code"] == item_code
            amt = float(sub_in_groups[mask]["Order_Amount"].sum())
            if amt > 0:
                group_item_flow[(gcode_str, item_code)] += amt

        # Customer → group amount for this group
        for _, row in grp_rows.iterrows():
            cust_to_group[(row["Party_Code"], gcode_str)] += float(row["Order_Amount"])

    # ---- Build labels ----
    sources_list = sorted(set(c for c, _ in cust_to_group))
    groups_list = sorted(gcode_str for gcode_str in set(g for _, g in cust_to_group))
    items_list = sorted(kept_items)

    all_labels = sources_list + groups_list + items_list
    label_lookup = {lbl: i for i, lbl in enumerate(all_labels)}

    src_indices: list[int] = []
    tgt_indices: list[int] = []
    values: list[float] = []

    # Links: Customer → Product Group
    for (c, g), val in sorted(cust_to_group.items(), key=lambda x: -x[1]):
        if g in label_lookup:
            src_indices.append(label_lookup[c])
            tgt_indices.append(label_lookup[g])
            values.append(round(val, 2))

    # Links: Product Group → Item
    for (g, i), val in sorted(group_item_flow.items(), key=lambda x: -x[1]):
        if g in label_lookup and i in label_lookup:
            src_indices.append(label_lookup[g])
            tgt_indices.append(label_lookup[i])
            values.append(round(val, 2))

    # Per-node revenue for hover
    node_revenue: defaultdict = defaultdict(float)
    for (c, g), val in cust_to_group.items():
        node_revenue[c] += val
        node_revenue[g] += val
    for (g, i), val in group_item_flow.items():
        node_revenue[g] += val
        node_revenue[i] += val

    return {
        "labels": all_labels,
        "source": src_indices,
        "target": tgt_indices,
        "value": values,
        "source_revenue": {k: round(v, 2) for k, v in node_revenue.items()},
        "target_revenue": {k: round(v, 2) for k, v in node_revenue.items()},
    }


def compute_sku_customer_type(df: pd.DataFrame) -> pd.DataFrame:
    """Classify each SKU by who buys it: Internal, External, or Internal + External.

    Unlike the product-group ``Risk_Category`` (which reflects only the
    *largest* customer of the group), this tags every party that ordered the
    SKU using the internal customer master and reports the full set of
    customer types that buy it.

    Parameters
    ----------
    df : pd.DataFrame
        Order Intake with ``Item_Code`` and ``Party_Code`` columns.

    Returns
    -------
    pd.DataFrame
        One row per ``Item_Code`` with a ``Customer Type`` column:
        ``"Internal"``, ``"External"``, or ``"Internal + External"``.
    """
    tag = pd.DataFrame(
        {
            "Item_Code": df["Item_Code"],
            "_type": df["Party_Code"].apply(_tag_internal),
        }
    )
    types_by_sku = (
        tag.groupby("Item_Code")["_type"]
        .agg(lambda s: tuple(sorted(set(s))))
        .reset_index()
    )

    def _label(types: tuple[str, ...]) -> str:
        if not types:
            return "No Orders"
        if len(types) == 1:
            return types[0]
        return "Internal + External"

    out = types_by_sku.copy()
    out["Customer Type"] = out["_type"].map(_label)
    return out[["Item_Code", "Customer Type"]]


def compute_internal_external_product_view(df: pd.DataFrame) -> list[dict[str, Any]]:
    """Compare product revenue split between Internal and External customers.

    Returns top products ranked by total revenue with internal/external breakdown.
    """
    df = df.copy()
    df["customer_type"] = df["Party_Code"].apply(_tag_internal)

    # Revenue per product × customer type
    grouped = (
        df.groupby(["Item_Code", "Item_Name", "customer_type"], as_index=False)["Order_Amount"]
        .sum()
        .rename(columns={"Order_Amount": "revenue"})
    )

    # Pivot: one row per product with internal_rev, external_rev
    pivot = grouped.pivot_table(
        index=["Item_Code", "Item_Name"],
        columns="customer_type",
        values="revenue",
        aggfunc="sum",
        fill_value=0,
    ).reset_index()

    pivot.columns = ["Item_Code", "Item_Name", "external_revenue", "internal_revenue"]
    pivot["total_revenue"] = pivot["external_revenue"] + pivot["internal_revenue"]
    pivot["external_pct"] = (
        (pivot["external_revenue"] / pivot["total_revenue"] * 100).round(1)
    )
    pivot["internal_pct"] = (
        (pivot["internal_revenue"] / pivot["total_revenue"] * 100).round(1)
    )
    pivot = pivot.sort_values("total_revenue", ascending=False).head(25)

    return [
        {
            "item_code": row["Item_Code"],
            "item_name": row["Item_Name"],
            "total_revenue": round(float(row["total_revenue"]), 2),
            "external_revenue": round(float(row["external_revenue"]), 2),
            "internal_revenue": round(float(row["internal_revenue"]), 2),
            "external_pct": float(row["external_pct"]),
            "internal_pct": float(row["internal_pct"]),
        }
        for _, row in pivot.iterrows()
    ]


def compute_business_drivers(df: pd.DataFrame) -> dict[str, Any]:
    """Compute business driver metrics: revenue bands, category depth, order patterns."""
    portfolio_df = compute_customer_portfolio(df)

    # Revenue bands
    bands = [
        {"label": "Micro (<₹10K)", "min": 0, "max": 10_000},
        {"label": "Small (₹10K-₹1L)", "min": 10_000, "max": 1_00_000},
        {"label": "Medium (₹1L-₹10L)", "min": 1_00_000, "max": 10_00_000},
        {"label": "Large (₹10L-₹1Cr)", "min": 10_00_000, "max": 1_00_00_000},
        {"label": "Enterprise (>₹1Cr)", "min": 1_00_00_000, "max": float("inf")},
    ]
    revenue_bands = []
    for band in bands:
        subset = portfolio_df[
            (portfolio_df["total_revenue"] >= band["min"])
            & (portfolio_df["total_revenue"] < band["max"])
        ]
        revenue_bands.append(
            {
                "band": band["label"],
                "customer_count": len(subset),
                "total_revenue": round(float(subset["total_revenue"].sum()), 2),
            }
        )

    # Order size distribution
    order_sizes = (
        df.groupby("OA_No", as_index=False)["Order_Amount"]
        .sum()["Order_Amount"]
    )
    size_bins = [
        {"label": "Tiny (<₹5K)", "min": 0, "max": 5_000},
        {"label": "Small (₹5K-₹50K)", "min": 5_000, "max": 50_000},
        {"label": "Medium (₹50K-₹5L)", "min": 50_000, "max": 5_00_000},
        {"label": "Large (₹5L-₹50L)", "min": 5_00_000, "max": 50_00_000},
        {"label": "Jumbo (>₹50L)", "min": 50_00_000, "max": float("inf")},
    ]
    order_bands = []
    for bin_ in size_bins:
        cnt = int(((order_sizes >= bin_["min"]) & (order_sizes < bin_["max"])).sum())
        order_bands.append({"band": bin_["label"], "order_count": cnt})

    return {
        "revenue_bands": revenue_bands,
        "order_bands": order_bands,
    }


def compute_concentration(portfolio: pd.DataFrame) -> list[dict[str, Any]]:
    """Compute Pareto concentration curve data from the portfolio.

    Returns a list of dicts with ``rank``, ``customer``, ``revenue``,
    ``cumul_revenue``, ``cumul_pct``, ``revenue_pct`` sorted by revenue descending.
    """
    total_rev = portfolio["total_revenue"].sum()
    points: list[dict[str, Any]] = []
    cumul = 0.0
    for i, (_, row) in enumerate(portfolio.iterrows()):
        rev = float(row["total_revenue"])
        cumul += rev
        points.append(
            {
                "rank": i + 1,
                "customer": row["Party_Code"],
                "revenue": round(rev, 2),
                "cumul_revenue": round(cumul, 2),
                "revenue_pct": round(rev / total_rev * 100, 2),
                "cumul_pct": round(cumul / total_rev * 100, 2),
                "customer_type": row["customer_type"],
            }
        )
    return points


def compute_top_products_per_customer(
    df: pd.DataFrame, top_n: int = 5
) -> list[dict[str, Any]]:
    """For each customer, return their top ``top_n`` products by revenue.

    Returns a flat list of dicts with ``party_code``, ``item_code``,
    ``item_name``, ``total_amount``, ``order_count``.
    """
    prod = (
        df.groupby(["Party_Code", "Item_Code", "Item_Name"], as_index=False)["Order_Amount"]
        .sum()
        .rename(columns={"Order_Amount": "total_amount"})
    )
    # Count separately
    count_s = (
        df.groupby(["Party_Code", "Item_Code", "Item_Name"], as_index=False)["Order_Amount"]
        .count()
        .rename(columns={"Order_Amount": "order_count"})
    )
    prod = prod.merge(count_s, on=["Party_Code", "Item_Code", "Item_Name"], how="left")

    results: list[dict[str, Any]] = []
    for party, group in prod.groupby("Party_Code"):
        top = group.sort_values("total_amount", ascending=False).head(top_n)
        for _, row in top.iterrows():
            results.append(
                {
                    "party_code": party,
                    "item_code": row["Item_Code"],
                    "item_name": row["Item_Name"],
                    "total_amount": round(float(row["total_amount"]), 2),
                    "order_count": int(row["order_count"]),
                }
            )
    return results


def compute_category_preferences(df: pd.DataFrame) -> list[dict[str, Any]]:
    """Aggregate revenue and customer count per product category.

    Returns sorted by total revenue descending.
    """
    cat = (
        df.groupby("Item_Category_Code", as_index=False)
        .agg(
            total_revenue=("Order_Amount", "sum"),
            customer_count=("Party_Code", "nunique"),
            order_count=("OA_No", "nunique"),
        )
        .sort_values("total_revenue", ascending=False)
        .reset_index(drop=True)
    )
    total_rev = cat["total_revenue"].sum()
    return [
        {
            "category": row["Item_Category_Code"],
            "total_revenue": round(float(row["total_revenue"]), 2),
            "revenue_pct": round(float(row["total_revenue"] / total_rev * 100), 2),
            "customer_count": int(row["customer_count"]),
            "order_count": int(row["order_count"]),
        }
        for _, row in cat.iterrows()
    ]


def compute_kpis(portfolio: pd.DataFrame) -> dict[str, Any]:
    """Compute high-level KPIs.

    Returns
    -------
    dict with keys: total_customers, total_revenue, avg_revenue_per_customer,
    top5_pct_revenue, top20_pct_revenue, internal_revenue, external_revenue.
    """
    total_rev = float(portfolio["total_revenue"].sum())
    n = len(portfolio)
    avg_rev = total_rev / n if n > 0 else 0.0

    # Top 5% customers cumulative revenue share
    top5_count = max(1, round(n * 0.05))
    top5_rev = float(portfolio.head(top5_count)["total_revenue"].sum())
    top5_pct = round(top5_rev / total_rev * 100, 1) if total_rev > 0 else 0.0

    # Top 20% customers
    top20_count = max(1, round(n * 0.20))
    top20_rev = float(portfolio.head(top20_count)["total_revenue"].sum())
    top20_pct = round(top20_rev / total_rev * 100, 1) if total_rev > 0 else 0.0

    # Internal vs External revenue
    internal_rev = float(portfolio[portfolio["customer_type"] == "Internal"]["total_revenue"].sum())
    external_rev = total_rev - internal_rev

    return {
        "total_customers": n,
        "total_revenue": round(total_rev, 2),
        "avg_revenue_per_customer": round(avg_rev, 2),
        "top5_pct_revenue": top5_pct,
        "top20_pct_revenue": top20_pct,
        "top5_customer_count": top5_count,
        "top20_customer_count": top20_count,
        "internal_revenue": round(internal_rev, 2),
        "external_revenue": round(external_rev, 2),
        "internal_customer_count": int((portfolio["customer_type"] == "Internal").sum()),
        "external_customer_count": int((portfolio["customer_type"] == "External").sum()),
    }


def run_customer_analytics(intake: pd.DataFrame) -> dict[str, Any]:
    """Run all customer analytics and return a single JSON-serializable dict.

    Parameters
    ----------
    intake : pd.DataFrame
        The order intake DataFrame (from ``load_order_intake``).

    Returns
    -------
    dict with keys: ``portfolio``, ``concentration``, ``topProducts``,
    ``categoryPrefs``, ``kpis``, ``customerRiskDistribution``,
    ``sankeyData``, ``internalExternalProducts``, ``businessDrivers``.
    """
    portfolio = compute_customer_portfolio(intake)
    return {
        "portfolio": portfolio.to_dict(orient="records"),
        "concentration": compute_concentration(portfolio),
        "topProducts": compute_top_products_per_customer(intake),
        "categoryPrefs": compute_category_preferences(intake),
        "kpis": compute_kpis(portfolio),
        "customerRiskDistribution": compute_customer_risk_distribution(portfolio),
        "sankeyData": compute_multi_product_sankey(intake),
        "internalExternalProducts": compute_internal_external_product_view(intake),
        "businessDrivers": compute_business_drivers(intake),
        "filterDimensions": {
            "categories": sorted(intake["Item_Category_Code"].dropna().unique().tolist()),
            "productGroups": sorted(intake["Product Group Code"].dropna().unique().astype(str).tolist()),
            "subGroups": sorted(intake["Product_SubGroup_Code"].dropna().unique().tolist()),
        },
    }
