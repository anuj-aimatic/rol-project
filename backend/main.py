#!/usr/bin/env python3
"""CLI entry point for the ABC-RFM-Risk-ROL pipeline.

Uses a **single** Order Intake Excel file as the input for all stages
(segmentation + ROL). Select the sheet via ``--sheet`` (default: M1).

Usage:
    python -m backend.main                         # uses default M1 sheet
    python -m backend.main --sheet M1               # sheet M1
    python -m backend.main --sheet "M2&H2"          # sheet M2&H2
    python -m backend.main --intake "path.xlsx" --output "result.csv"
"""

from __future__ import annotations

import argparse
from pathlib import Path

from backend.config import DEFAULT_INTAKE_FILE, DEFAULT_INTAKE_SHEET
from backend.pipeline import run_pipeline

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    parser = argparse.ArgumentParser(
        description="ABC-RFM-Risk-ROL pipeline — produces a single combined CSV "
                    "with all SKU-level metrics including rol_static and rol_dynamic.",
    )
    parser.add_argument(
        "--intake",
        type=str,
        default=str(PROJECT_ROOT / DEFAULT_INTAKE_FILE),
        help="Path to Order Intake Incl Amounts.xlsx",
    )
    parser.add_argument(
        "--sheet",
        type=str,
        default=DEFAULT_INTAKE_SHEET,
        help=f'Sheet name to process (default: "{DEFAULT_INTAKE_SHEET}"; also "M2&H2")',
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Output CSV path (optional — previews first rows if omitted)",
    )
    parser.add_argument(
        "--service-level",
        type=float,
        default=0.85,
        help="Service level (default: 0.85)",
    )
    parser.add_argument(
        "--lead-time",
        type=int,
        default=4,
        help="Lead time in weeks (default: 4)",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("  ABC-RFM-Risk-ROL Pipeline  (single input file)")
    print("=" * 60)
    print(f"  Intake file : {args.intake}")
    print(f"  Sheet       : {args.sheet}")
    print(f"  Output      : {args.output or '(stdout preview)'}")
    print(f"  Service lvl : {args.service_level}")
    print(f"  Lead time   : {args.lead_time} weeks")
    print("=" * 60)
    print()

    final = run_pipeline(
        intake_path=args.intake,
        intake_sheet=args.sheet,
        service_level=args.service_level,
        lead_time=args.lead_time,
        output_path=args.output,
    )

    print()
    print("--- Final columns ---")
    print(list(final.columns))
    print()
    print("--- Sample (first 5 rows) ---")
    show_cols = [
        "Item_Code", "ABC_Class", "RFM_Category", "Risk_Category",
        "mode_order_qty", "rol_static", "rol_dynamic",
    ]
    print(final[show_cols].head(10).to_string(index=False))
    print()
    print(f"Total SKUs: {len(final)}")


if __name__ == "__main__":
    main()
