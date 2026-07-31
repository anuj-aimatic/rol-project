"""FastAPI entry point for the ABC-RFM-Risk-ROL pipeline.

Uses the production ``backend.pipeline.run_pipeline`` under the hood.
Endpoints mirror the original design but return all real 43 columns with
both ``rol_static`` and ``rol_dynamic`` in every response.
"""

from __future__ import annotations

from io import BytesIO
from tempfile import NamedTemporaryFile

import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from backend.customer_analytics import run_customer_analytics
from backend.data_loader import load_order_intake
from backend.pipeline import run_pipeline

app = FastAPI(title="Inventory Analytics API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- In-memory cache (single-session) ----
_latest_result: pd.DataFrame | None = None
_latest_excel: bytes | None = None
_latest_workbook: bytes | None = None
_latest_sheets: list[str] | None = None
_latest_intake: pd.DataFrame | None = None  # cached Order Intake for customer analytics


def _list_sheets(content: bytes) -> list[str]:
    """Return sheet names from an in-memory Excel file."""
    with NamedTemporaryFile(suffix=".xlsx") as tmp:
        tmp.write(content)
        tmp.flush()
        xl = pd.ExcelFile(tmp.name)
        return xl.sheet_names


def _run(content: bytes, sheet: str, service_level: float, lead_time: int) -> pd.DataFrame:
    """Write content to temp file, run pipeline, return DataFrame."""
    with NamedTemporaryFile(suffix=".xlsx") as tmp:
        tmp.write(content)
        tmp.flush()
        df = run_pipeline(
            intake_path=tmp.name,
            intake_sheet=sheet,
            service_level=service_level,
            lead_time=lead_time,
        )
    return df


def _df_to_excel_bytes(df: pd.DataFrame) -> bytes:
    buf = BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Final_Output")
    buf.seek(0)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/sheets")
async def upload_and_list_sheets(file: UploadFile = File(...)) -> list[str]:
    """Upload a workbook and return its sheet names (cached server-side)."""
    global _latest_workbook, _latest_sheets

    if not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Only Excel files are supported")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    try:
        sheets = _list_sheets(content)
        _latest_workbook = content
        _latest_sheets = sheets
        return sheets
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to read workbook: {exc}") from exc


@app.get("/sheets")
def list_cached_sheets() -> list[str]:
    """Return cached sheet names from a previous upload."""
    if not _latest_sheets:
        raise HTTPException(
            status_code=404,
            detail="No workbook cached. Upload via POST /sheets first.",
        )
    return _latest_sheets


@app.post("/process")
async def process(
    file: UploadFile | None = File(default=None),
    sheet_name: str = Form(...),
    service_level: float = Form(0.85),
    lead_time: int = Form(4),
) -> dict[str, object]:
    """
    Run the full ABC-RFM-Risk-ROL pipeline.

    Returns 43 columns per SKU including ``rol_static``, ``rol_dynamic``,
    ``st_*`` / ``dy_*`` metric groups, and the full hierarchical
    ABC + RFM + Risk classification.
    """
    global _latest_result, _latest_excel, _latest_workbook, _latest_sheets, _latest_intake

    if not (0 < service_level <= 1):
        raise HTTPException(status_code=400, detail="service_level must be between 0 and 1")
    if lead_time < 1:
        raise HTTPException(status_code=400, detail="lead_time must be >= 1")

    # Resolve workbook content
    content: bytes | None = None
    if file is not None:
        if not file.filename.lower().endswith((".xlsx", ".xls")):
            raise HTTPException(status_code=400, detail="Only Excel files are supported")
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")
        _latest_workbook = content
    else:
        content = _latest_workbook
        if content is None:
            raise HTTPException(
                status_code=400,
                detail="No file provided and no cached workbook found. Upload a file first.",
            )

    try:
        df = _run(content, sheet_name, service_level, lead_time)
        _latest_sheets = [sheet_name]
        _latest_result = df.copy()
        _latest_excel = _df_to_excel_bytes(df)

        # Also compute customer analytics from the same workbook
        from tempfile import NamedTemporaryFile
        with NamedTemporaryFile(suffix=".xlsx") as tmp:
            tmp.write(content)
            tmp.flush()
            intake = load_order_intake(tmp.name, sheet_name=sheet_name)
        _latest_intake = intake.copy()
        customer_analytics = run_customer_analytics(intake)

        return {
            "sheetName": sheet_name,
            "serviceLevel": service_level,
            "leadTime": lead_time,
            "rows": int(len(df)),
            "columns": list(df.columns),
            "data": df.to_dict(orient="records"),
            "customerAnalytics": customer_analytics,
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/customer-analytics")
async def customer_analytics() -> dict[str, object]:
    """
    Compute customer-level analytics from the cached intake DataFrame.

    The intake DataFrame is cached during pipeline execution (``/process``).
    If not available, run the pipeline from Overview first.

    Returns portfolio (per-customer), concentration (Pareto curve),
    top products, category preferences, and high-level KPIs.
    """
    global _latest_intake

    if _latest_intake is None:
        raise HTTPException(
            status_code=400,
            detail="No intake data cached. Run the pipeline from Overview first.",
        )

    try:
        result = run_customer_analytics(_latest_intake)
        return result  # type: ignore[return-value]
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/product/{item_code}")
def product(item_code: str) -> dict[str, object]:
    """Return a single product's full row by Item_Code."""
    if _latest_result is None:
        raise HTTPException(status_code=404, detail="No processed dataset found. Call /process first")

    match = _latest_result[_latest_result["Item_Code"].astype(str) == str(item_code)]
    if match.empty:
        raise HTTPException(status_code=404, detail=f"Item_Code {item_code} not found")

    return match.iloc[0].to_dict()


@app.get("/download")
def download() -> StreamingResponse:
    """Download the latest pipeline result as an Excel file."""
    if _latest_excel is None:
        raise HTTPException(status_code=404, detail="No generated file found. Call /process first")

    return StreamingResponse(
        BytesIO(_latest_excel),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=inventory_pipeline_output.xlsx"},
    )
