"""Configuration constants and lookup tables."""

from __future__ import annotations

# Default file path (relative to project root)
DEFAULT_INTAKE_FILE = "notebook/Order Intake Incl Amounts.xlsx"
DEFAULT_INTAKE_SHEET = "M1"  # or "M2&H2"

# FG Stock export (open stock per SKU, mapped on Item_Code)
DEFAULT_FG_STOCK_FILE = "data/FG Stock as on 31-Jul-26.xlsx"
DEFAULT_FG_STOCK_SHEET = "Export"  # first sheet if missing

# Fraction of unit sales price used as unit cost for stock/deficit valuation
UNIT_COST_FACTOR = 0.65

# Service level & lead time
DEFAULT_SERVICE_LEVEL = 0.65
DEFAULT_LEAD_TIME_WEEKS = 4

# The intake "Lead Time" column is expressed in DAYS (e.g. 21, 28, 50). The ROL
# safety-stock formula requires weeks, so per-SKU lead times are divided by this
# factor at the extraction boundary (pipeline + API). The global lead_time input
# remains in weeks.
DAYS_PER_WEEK = 7.0

# Risk-category-based service levels (Risk-Based mode). Each SKU uses the
# level of its own Risk_Category; SKUs with any other category fall back to
# DEFAULT_SERVICE_LEVEL.
DEFAULT_RISK_SERVICE_LEVELS: dict[str, float] = {
    "High_Risk_External": 0.65,
    "Low_Risk_External": 0.85,
    "Medium_Risk_External": 0.65,
    "Medium_Risk_Internal": 0.85,
}

# Static ROL volume thresholds
LOW_VOLUME_THRESHOLD = 300
MEDIUM_VOLUME_THRESHOLD = 600
MEDIUM_BIN_SIZE = 12
HIGH_BIN_SIZE = 24

# Interpolation threshold for Dmax
INTERPOLATION_THRESHOLD = 0.05  # 5 percentage points

# RFM quantile count
RFM_QUANTILES = 5

# Internal customer master
INTERNAL_PARTY_CODES: set[str] = {"CF008", "CF028", "CL0049", "CO015", "CF038", "CF039"}
