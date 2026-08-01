"""FastAPI entry point for the ABC-RFM-Risk-ROL pipeline.

Uses the production ``backend.pipeline.run_pipeline`` under the hood.
Endpoints mirror the original design but return all real 43 columns with
both ``rol_static`` and ``rol_dynamic`` in every response.
"""

from __future__ import annotations

import json
import os
import tempfile
from io import BytesIO
from pathlib import Path
from tempfile import NamedTemporaryFile

import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from backend.customer_analytics import run_customer_analytics
from backend.data_loader import load_order_intake
from backend.fg_stock import enrich_with_fg_stock
from backend.pipeline import _build_weekly_from_intake, run_pipeline
from backend.rol_calculator import compute_rol_sensitivity, compute_rol_steps_for_item, recompute_rol_columns

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
_latest_service_level: float = 0.85
_latest_lead_time: int = 4

# ---- Disk-backed cache (survives API restarts) ----
CACHE_DIR = Path(os.environ.get("ROL_CACHE_DIR", os.path.join(tempfile.gettempdir(), "rol_pipeline_cache")))


def _cache_path(name: str) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return CACHE_DIR / name


def _persist_cache() -> None:
    """Write the in-memory cache to disk so a restart doesn't lose the workbook."""
    try:
        if _latest_workbook:
            with open(_cache_path("workbook.bin"), "wb") as f:
                f.write(_latest_workbook)
        if _latest_excel:
            with open(_cache_path("excel.bin"), "wb") as f:
                f.write(_latest_excel)
        if _latest_sheets is not None:
            with open(_cache_path("sheets.json"), "w") as f:
                json.dump(_latest_sheets, f)
        with open(_cache_path("params.json"), "w") as f:
            json.dump(
                {"service_level": _latest_service_level, "lead_time": _latest_lead_time},
                f,
            )
        if _latest_result is not None:
            _latest_result.to_pickle(_cache_path("result.pkl"))
        if _latest_intake is not None:
            _latest_intake.to_pickle(_cache_path("intake.pkl"))
    except Exception:
        # Cache is best-effort; never crash a request because of it
        pass


def _load_cache() -> None:
    """Restore the cache from disk on startup (best-effort)."""
    global _latest_workbook, _latest_result, _latest_excel, _latest_sheets
    global _latest_intake, _latest_service_level, _latest_lead_time
    try:
        wb = _cache_path("workbook.bin")
        if wb.exists() and wb.stat().st_size > 0:
            _latest_workbook = wb.read_bytes()
        ex = _cache_path("excel.bin")
        if ex.exists() and ex.stat().st_size > 0:
            _latest_excel = ex.read_bytes()
        sh = _cache_path("sheets.json")
        if sh.exists():
            _latest_sheets = json.loads(sh.read_text())
        pa = _cache_path("params.json")
        if pa.exists():
            params = json.loads(pa.read_text())
            _latest_service_level = params.get("service_level", 0.85)
            _latest_lead_time = params.get("lead_time", 4)
        rs = _cache_path("result.pkl")
        if rs.exists() and rs.stat().st_size > 0:
            _latest_result = pd.read_pickle(rs)
        in_ = _cache_path("intake.pkl")
        if in_.exists() and in_.stat().st_size > 0:
            _latest_intake = pd.read_pickle(in_)
    except Exception:
        pass


# Restore any previously cached workbook at startup
_load_cache()


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
        # A new workbook invalidates any previously computed results — both in
        # memory and on disk — so a fresh upload never serves stale data
        _latest_result = None
        _latest_excel = None
        _latest_intake = None
        for stale in ("excel.bin", "result.pkl", "intake.pkl"):
            p = _cache_path(stale)
            if p.exists():
                p.unlink()
        _latest_workbook = content
        _latest_sheets = sheets
        _persist_cache()
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
    global _latest_service_level, _latest_lead_time

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
        _latest_service_level = service_level
        _latest_lead_time = lead_time

        # Also compute customer analytics from the same workbook
        from tempfile import NamedTemporaryFile
        with NamedTemporaryFile(suffix=".xlsx") as tmp:
            tmp.write(content)
            tmp.flush()
            intake = load_order_intake(tmp.name, sheet_name=sheet_name)
        _latest_intake = intake.copy()
        customer_analytics = run_customer_analytics(intake)

        _persist_cache()

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


@app.post("/recompute-rol")
async def recompute_rol(
    service_level: float = Form(...),
    lead_time: int | None = Form(default=None),
) -> dict[str, object]:
    """Recompute only the ROL columns with a new service level (fast path).

    Uses the cached pipeline output + cached Order Intake; segmentation
    (ABC/RFM/Risk) is untouched, so any service level can be applied in
    seconds without re-running the full pipeline.

    Returns the same shape as ``/process`` (rows/columns/data + parameters).
    """
    global _latest_result, _latest_excel, _latest_intake
    global _latest_service_level, _latest_lead_time

    if _latest_intake is None or _latest_result is None:
        raise HTTPException(
            status_code=400,
            detail="No processed data cached. Run the pipeline from Overview first.",
        )
    if not (0 < service_level <= 1):
        raise HTTPException(status_code=400, detail="service_level must be between 0 and 1")
    if lead_time is not None and lead_time < 1:
        raise HTTPException(status_code=400, detail="lead_time must be >= 1")

    try:
        weekly = _build_weekly_from_intake(_latest_intake)

        # Per-SKU lead time, mirroring the pipeline's lead_time_map logic
        lead_time_map: dict[str, float] = {}
        if "Lead Time" in _latest_intake.columns:
            lead_time_map = (
                _latest_intake.groupby("Item_Code")["Lead Time"]
                .agg(lambda x: float(x.mode().iloc[0]) if not x.mode().empty else float(x.median()))
                .fillna(float(_latest_lead_time))
                .to_dict()
            )

        df = recompute_rol_columns(
            _latest_result,
            weekly,
            service_level=service_level,
            lead_time=_latest_lead_time if lead_time is None else lead_time,
            lead_time_map=lead_time_map if lead_time_map else None,
        )

        # ROL-driven FG Stock columns must track the new service level
        df = enrich_with_fg_stock(df)

        _latest_result = df.copy()
        _latest_excel = _df_to_excel_bytes(df)
        _latest_service_level = service_level
        _latest_lead_time = _latest_lead_time if lead_time is None else lead_time
        _persist_cache()

        return {
            "rows": int(len(df)),
            "columns": list(df.columns),
            "data": df.to_dict(orient="records"),
            "serviceLevel": service_level,
            "leadTime": _latest_lead_time,
        }
    except HTTPException:
        raise
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


@app.get("/product/{item_code}/rol-steps")
def product_rol_steps(item_code: str) -> dict[str, object]:
    """Return the step-by-step Static & Dynamic ROL calculation for one SKU.

    Recomputes the trace on demand from the cached Order Intake using the
    exact same helpers as the pipeline, so every intermediate value and the
    final ROL agree with the numbers shown in the explorer table.
    """
    global _latest_intake, _latest_service_level, _latest_lead_time

    if _latest_intake is None:
        raise HTTPException(
            status_code=400,
            detail="No intake data cached. Run the pipeline from Overview first.",
        )

    try:
        weekly = _build_weekly_from_intake(_latest_intake)
        # Per-SKU lead time, mirroring the pipeline exactly (truncated to int
        # inside add_rol_columns so the trace always equals the table values)
        lead_time = int(_latest_lead_time)
        if "Lead Time" in _latest_intake.columns:
            lt_rows = _latest_intake.loc[_latest_intake["Item_Code"] == item_code, "Lead Time"]
            if not lt_rows.mode().empty:
                lead_time = int(lt_rows.mode().iloc[0])
        steps = compute_rol_steps_for_item(
            weekly,
            item_code,
            service_level=_latest_service_level,
            lead_time=lead_time,
        )
        if steps is None:
            raise HTTPException(status_code=404, detail=f"Item_Code {item_code} not found in intake data")
        return steps
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/product/{item_code}/rol-sensitivity")
def product_rol_sensitivity(item_code: str) -> dict[str, object]:
    """Return Static & Dynamic ROL across a sweep of service levels (what-if).

    X axis = service level (50% → 95%), Y axis = ROL (units). Used by the
    product detail page's sensitivity chart. Recomputed on demand from the
    cached Order Intake with the exact same helpers as the pipeline.
    """
    global _latest_intake, _latest_lead_time

    if _latest_intake is None:
        raise HTTPException(
            status_code=400,
            detail="No intake data cached. Run the pipeline from Overview first.",
        )

    try:
        weekly = _build_weekly_from_intake(_latest_intake)
        # Per-SKU lead time, mirroring the pipeline (truncated to int)
        lead_time = int(_latest_lead_time)
        if "Lead Time" in _latest_intake.columns:
            lt_rows = _latest_intake.loc[_latest_intake["Item_Code"] == item_code, "Lead Time"]
            if not lt_rows.mode().empty:
                lead_time = int(lt_rows.mode().iloc[0])
        points = compute_rol_sensitivity(weekly, item_code, lead_time=lead_time)
        if points is None:
            raise HTTPException(status_code=404, detail=f"Item_Code {item_code} not found in intake data")
        return {"item_code": item_code, "lead_time": lead_time, "points": points}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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
