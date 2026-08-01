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
