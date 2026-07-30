"""Configuration constants and lookup tables."""

from __future__ import annotations

# Default file path (relative to project root)
DEFAULT_INTAKE_FILE = "notebook/Order Intake Incl Amounts.xlsx"
DEFAULT_INTAKE_SHEET = "M2&H2"  # or "M2&H2"

# Service level & lead time
DEFAULT_SERVICE_LEVEL = 0.85
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
