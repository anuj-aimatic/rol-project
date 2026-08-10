"""FastAPI entry point for the ABC-RFM-Risk-ROL pipeline.

Uses the production ``backend.pipeline.run_pipeline`` under the hood.
Endpoints mirror the original design but return all real 43 columns with
both ``rol_static`` and ``rol_dynamic`` in every response.
"""

from __future__ import annotations

import json
import os
import tempfile
import urllib.parse
from io import BytesIO
from pathlib import Path
from tempfile import NamedTemporaryFile

import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from backend.customer_analytics import run_customer_analytics
from backend.config import DAYS_PER_WEEK, DEFAULT_RISK_SERVICE_LEVELS
from backend.data_loader import load_fg_stock, load_order_intake
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
_latest_results: dict[str, pd.DataFrame] = {}
_latest_customer_analytics: dict[str, dict] = {}
_latest_intakes: dict[str, pd.DataFrame] = {}
_latest_excel: bytes | None = None
_latest_workbook: bytes | None = None
_latest_sheets: list[str] | None = None
_latest_intake: pd.DataFrame | None = None  # cached Order Intake for customer analytics
_latest_fg_stock: pd.DataFrame | None = None  # cached FG Stock export (uploaded or default)
_latest_service_level: float = 0.85
_latest_service_level_mode: str = "global"  # "global" | "risk"
_latest_risk_service_levels: dict[str, float] | None = None
_latest_lead_time: int = 4

# ---- Disk-backed cache (survives API restarts) ----
CACHE_DIR = Path(os.environ.get("ROL_CACHE_DIR", os.path.join(tempfile.gettempdir(), "rol_pipeline_cache")))


def _cache_path(name: str) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return CACHE_DIR / name


def _sheet_cache_filename(sheet_name: str) -> str:
    return f"result_{urllib.parse.quote_plus(sheet_name)}.pkl"


def _customer_analytics_cache_filename(sheet_name: str) -> str:
    return f"customer_analytics_{urllib.parse.quote_plus(sheet_name)}.json"


def _persist_cache() -> None:
    """Write the in-memory cache to disk so a restart doesn't lose the workbook.

    Best-effort, guarded per artifact: a single failure (e.g. a non-JSON value
    inside customer analytics) must never block the critical files
    (``result.pkl`` / ``intake.pkl`` / ``fg_stock.pkl``) from being written —
    otherwise a restart would lose the processed data and /recompute-rol would
    no longer be able to Apply.
    """

    def _persist_one(name: str, writer: object) -> None:
        try:
            writer()  # type: ignore[operator]
        except Exception as exc:
            print(f"[cache] failed to persist {name}: {exc}")

    _persist_one("workbook.bin", lambda: _cache_path("workbook.bin").write_bytes(_latest_workbook) if _latest_workbook else None)
    _persist_one("excel.bin", lambda: _cache_path("excel.bin").write_bytes(_latest_excel) if _latest_excel else None)
    _persist_one("sheets.json", lambda: _cache_path("sheets.json").write_text(json.dumps(_latest_sheets)) if _latest_sheets is not None else None)
    _persist_one(
        "params.json",
        lambda: _cache_path("params.json").write_text(
            json.dumps(
                {
                    "service_level": _latest_service_level,
                    "lead_time": _latest_lead_time,
                    "service_level_mode": _latest_service_level_mode,
                    "risk_service_levels": _latest_risk_service_levels,
                }
            )
        ),
    )
    _persist_one(
        "result_*.pkl",
        lambda: [
            df.to_pickle(_cache_path(_sheet_cache_filename(sheet_name)))
            for sheet_name, df in _latest_results.items()
        ],
    )
    _persist_one(
        "intake_*.pkl",
        lambda: [
            intake.to_pickle(_cache_path(f"intake_{urllib.parse.quote_plus(sheet_name)}.pkl"))
            for sheet_name, intake in _latest_intakes.items()
        ],
    )
    _persist_one(
        "customer_analytics_*.json",
        lambda: [
            # default=str keeps pandas/numpy/date values cacheable — the API
            # response is still fully typed via FastAPI's jsonable_encoder.
            _cache_path(_customer_analytics_cache_filename(sheet_name)).write_text(
                json.dumps(analytics, default=str)
            )
            for sheet_name, analytics in _latest_customer_analytics.items()
        ],
    )
    _persist_one("result.pkl", lambda: _latest_result.to_pickle(_cache_path("result.pkl")) if _latest_result is not None else None)
    _persist_one("intake.pkl", lambda: _latest_intake.to_pickle(_cache_path("intake.pkl")) if _latest_intake is not None else None)
    _persist_one("fg_stock.pkl", lambda: _latest_fg_stock.to_pickle(_cache_path("fg_stock.pkl")) if _latest_fg_stock is not None else None)


def _load_cache() -> None:
    """Restore the cache from disk on startup (best-effort)."""
    global _latest_workbook, _latest_result, _latest_results, _latest_customer_analytics, _latest_intakes, _latest_excel, _latest_sheets
    global _latest_intake, _latest_fg_stock
    global _latest_service_level, _latest_lead_time
    global _latest_service_level_mode, _latest_risk_service_levels
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
            _latest_service_level_mode = params.get("service_level_mode", "global")
            _latest_risk_service_levels = params.get("risk_service_levels")
        rs = _cache_path("result.pkl")
        if rs.exists() and rs.stat().st_size > 0:
            _latest_result = pd.read_pickle(rs)
        for result_file in CACHE_DIR.glob("result_*.pkl"):
            sheet_name = urllib.parse.unquote_plus(result_file.stem.removeprefix("result_"))
            try:
                _latest_results[sheet_name] = pd.read_pickle(result_file)
            except Exception:
                continue
        for intake_file in CACHE_DIR.glob("intake_*.pkl"):
            sheet_name = urllib.parse.unquote_plus(intake_file.stem.removeprefix("intake_"))
            try:
                _latest_intakes[sheet_name] = pd.read_pickle(intake_file)
            except Exception:
                continue
        for analytics_file in CACHE_DIR.glob("customer_analytics_*.json"):
            sheet_name = urllib.parse.unquote_plus(analytics_file.stem.removeprefix("customer_analytics_"))
            try:
                _latest_customer_analytics[sheet_name] = json.loads(analytics_file.read_text(encoding="utf-8"))
            except Exception:
                continue
        in_ = _cache_path("intake.pkl")
        if in_.exists() and in_.stat().st_size > 0:
            _latest_intake = pd.read_pickle(in_)
        fg = _cache_path("fg_stock.pkl")
        if fg.exists() and fg.stat().st_size > 0:
            _latest_fg_stock = pd.read_pickle(fg)
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


def _run(
    content: bytes,
    sheet: str,
    service_level: float,
    lead_time: int,
    service_level_map: dict[str, float] | None = None,
    fg_stock: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Write content to temp file, run pipeline, return DataFrame."""
    with NamedTemporaryFile(suffix=".xlsx") as tmp:
        tmp.write(content)
        tmp.flush()
        df = run_pipeline(
            intake_path=tmp.name,
            intake_sheet=sheet,
            service_level=service_level,
            lead_time=lead_time,
            service_level_map=service_level_map,
            fg_stock=fg_stock,
        )
    return df


async def _parse_fg_stock_upload(fg_stock_file: UploadFile) -> pd.DataFrame:
    """Parse an uploaded FG Stock export into the normalized two-column frame.

    Raises HTTPException(400) for non-Excel files, empty uploads, files missing
    the required ``Item_Code`` / ``Open FG Stock`` columns, or files with no
    usable SKU rows.
    """
    if not fg_stock_file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Only Excel files are supported for FG Stock")

    content = await fg_stock_file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded FG Stock file is empty")

    try:
        with NamedTemporaryFile(suffix=".xlsx") as tmp:
            tmp.write(content)
            tmp.flush()
            parsed = load_fg_stock(tmp.name)
        if parsed.empty:
            raise HTTPException(
                status_code=400,
                detail="FG Stock file contains no valid SKU rows (missing Item_Code / Open FG Stock values)",
            )
        return parsed
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid FG Stock file: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to read FG Stock file: {exc}") from exc


def _build_service_level_map(
    mode: str,
    risk_high_external: float,
    risk_low_external: float,
    risk_medium_external: float,
    risk_medium_internal: float,
) -> dict[str, float] | None:
    """Return a Risk_Category → service level map, or None for global mode."""
    if mode != "risk":
        return None
    return {
        "High_Risk_External": risk_high_external,
        "Low_Risk_External": risk_low_external,
        "Medium_Risk_External": risk_medium_external,
        "Medium_Risk_Internal": risk_medium_internal,
    }


def _df_to_excel_bytes(df: pd.DataFrame) -> bytes:
    buf = BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Final_Output")
    buf.seek(0)
    return buf.getvalue()


def _run_and_cache(
    content: bytes,
    sheet_name: str,
    service_level: float,
    lead_time: int,
    service_level_map: dict[str, float] | None,
    fg_stock: pd.DataFrame | None,
) -> pd.DataFrame:
    """Run the full pipeline for a sheet and populate the in-memory caches.

    Shared by ``/process`` (fresh run) and ``/recompute-rol``'s last-resort
    recovery so both always produce identical results. The ``_latest_*``
    parameter globals are intentionally left to the callers, who set them
    according to their own request semantics.
    """
    global _latest_result, _latest_results, _latest_customer_analytics, _latest_intakes, _latest_excel, _latest_intake

    df = _run(content, sheet_name, service_level, lead_time, service_level_map, fg_stock)
    _latest_results[sheet_name] = df.copy()
    _latest_result = df.copy()
    _latest_excel = _df_to_excel_bytes(df)
    with NamedTemporaryFile(suffix=".xlsx") as tmp:
        tmp.write(content)
        tmp.flush()
        intake = load_order_intake(tmp.name, sheet_name=sheet_name)
    _latest_intakes[sheet_name] = intake.copy()
    _latest_intake = intake.copy()
    _latest_customer_analytics[sheet_name] = run_customer_analytics(intake)
    return df


def _can_use_cached_result(
    sheet_name: str,
    service_level: float,
    service_level_mode: str,
    service_level_map: dict[str, float] | None,
    lead_time: int,
) -> bool:
    if sheet_name not in _latest_results:
        return False
    if service_level != _latest_service_level:
        return False
    if service_level_mode != _latest_service_level_mode:
        return False
    if lead_time != _latest_lead_time:
        return False
    if service_level_mode == "risk":
        return _latest_risk_service_levels == service_level_map
    return _latest_risk_service_levels is None


def _ensure_recompute_data(sheet_name: str | None) -> None:
    """Make sure /recompute-rol has processed data to recompute.

    Recovery ladder — Apply must work even if the API restarted since the
    pipeline ran:

      1. in-memory caches already hold the data (normal fast path; when
         ``sheet_name`` is None this trusts the current global result);
      2. restore from the disk cache (survives API restarts);
      3. run the full pipeline for the requested sheet from the cached
         workbook (last resort — e.g. an older cache written before /process
         started persisting results), then persist it so the recovery sticks.

    Raises HTTPException(400) only when none of these can produce data.
    """
    global _latest_workbook, _latest_sheets

    def _ready() -> bool:
        if _latest_intake is None or _latest_result is None:
            return False
        if sheet_name is not None and (
            sheet_name not in _latest_results or sheet_name not in _latest_intakes
        ):
            return False
        return True

    if _ready():
        return

    _load_cache()  # the API may have restarted since the pipeline ran

    if _ready():
        return

    # Last resort: run the full pipeline for the requested sheet from the
    # cached workbook, using the last-applied parameters, so the recompute
    # below applies the user's requested change exactly like the fast path.
    content = _latest_workbook
    if content is None:
        wb = _cache_path("workbook.bin")
        if wb.exists() and wb.stat().st_size > 0:
            content = wb.read_bytes()
            _latest_workbook = content
    if content is None:
        raise HTTPException(
            status_code=400,
            detail="No processed data cached. Run the pipeline from Overview first.",
        )

    target = (
        sheet_name if sheet_name is not None else (_latest_sheets[0] if _latest_sheets else None)
    )
    if target is None:
        raise HTTPException(
            status_code=400,
            detail="No processed data cached. Run the pipeline from Overview first.",
        )

    try:
        _run_and_cache(
            content,
            target,
            _latest_service_level,
            _latest_lead_time,
            _latest_risk_service_levels,
            _latest_fg_stock,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to prepare data for recompute: {exc}",
        ) from exc
    _persist_cache()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/sheets")
async def upload_and_list_sheets(file: UploadFile = File(...)) -> dict[str, list[str]]:
    """Upload a workbook and return its sheet names (cached server-side)."""
    global _latest_result, _latest_results, _latest_customer_analytics, _latest_intakes, _latest_workbook, _latest_sheets

    if not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Only Excel files are supported")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    try:
        sheets = _list_sheets(content)
        # A new workbook invalidates any previously computed results — both in
        # memory and on disk — so a fresh upload never serves stale data.
        _latest_result = None
        _latest_results = {}
        _latest_intakes = {}
        _latest_customer_analytics = {}
        _latest_excel = None
        _latest_intake = None
        for stale in ("excel.bin", "result.pkl", "intake.pkl"):
            p = _cache_path(stale)
            if p.exists():
                p.unlink()
        for stale in CACHE_DIR.glob("result_*.pkl"):
            stale.unlink()
        for stale in CACHE_DIR.glob("intake_*.pkl"):
            stale.unlink()
        for stale in CACHE_DIR.glob("customer_analytics_*.json"):
            stale.unlink()
        _latest_workbook = content
        _latest_sheets = sheets
        _persist_cache()
        return {"sheets": sheets, "cachedSheets": []}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to read workbook: {exc}") from exc


@app.get("/sheets")
def list_cached_sheets() -> dict[str, list[str]]:
    """Return cached sheet names from a previous upload."""
    if not _latest_sheets:
        raise HTTPException(
            status_code=404,
            detail="No workbook cached. Upload via POST /sheets first.",
        )
    return {"sheets": _latest_sheets, "cachedSheets": list(_latest_results.keys())}


@app.post("/process")
async def process(
    file: UploadFile | None = File(default=None),
    sheet_name: str = Form(...),
    service_level: float = Form(0.85),
    lead_time: int = Form(4),
    service_level_mode: str = Form("global"),
    risk_high_external: float = Form(DEFAULT_RISK_SERVICE_LEVELS["High_Risk_External"]),
    risk_low_external: float = Form(DEFAULT_RISK_SERVICE_LEVELS["Low_Risk_External"]),
    risk_medium_external: float = Form(DEFAULT_RISK_SERVICE_LEVELS["Medium_Risk_External"]),
    risk_medium_internal: float = Form(DEFAULT_RISK_SERVICE_LEVELS["Medium_Risk_Internal"]),
    fg_stock_file: UploadFile | None = File(default=None),
) -> dict[str, object]:
    """
    Run the full ABC-RFM-Risk-ROL pipeline.

    ``service_level_mode`` is ``"global"`` (one level for every SKU) or
    ``"risk"`` (per-SKU level from the SKU's Risk_Category). In risk mode the
    four ``risk_*_external/internal`` fields supply the level for each risk
    category; SKUs with any other Risk_Category fall back to ``service_level``.

    ``fg_stock_file`` is an optional FG Stock export (``Item_Code`` +
    ``Open FG Stock``). When provided it replaces the default FG Stock file;
    when omitted, the previously uploaded/cached export (or the default file)
    is used.

    Returns 43+ columns per SKU including ``rol_static``, ``rol_dynamic``,
    ``st_*`` / ``dy_*`` metric groups, the full hierarchical
    ABC + RFM + Risk classification, and a per-SKU ``service_level`` column.
    """
    global _latest_result, _latest_results, _latest_customer_analytics, _latest_intakes, _latest_excel, _latest_workbook, _latest_sheets, _latest_intake
    global _latest_fg_stock
    global _latest_service_level, _latest_lead_time
    global _latest_service_level_mode, _latest_risk_service_levels

    if service_level_mode not in ("global", "risk"):
        raise HTTPException(status_code=400, detail="service_level_mode must be 'global' or 'risk'")
    if not (0 < service_level <= 1):
        raise HTTPException(status_code=400, detail="service_level must be between 0 and 1")
    if lead_time < 1:
        raise HTTPException(status_code=400, detail="lead_time must be >= 1")

    service_level_map = _build_service_level_map(
        service_level_mode,
        risk_high_external,
        risk_low_external,
        risk_medium_external,
        risk_medium_internal,
    )
    if service_level_map:
        for name, value in service_level_map.items():
            if not (0 < value <= 1):
                raise HTTPException(
                    status_code=400,
                    detail=f"{name} service level must be between 0 and 1",
                )

    # Resolve workbook content
    content: bytes | None = None
    if file is not None:
        if not file.filename.lower().endswith((".xlsx", ".xls")):
            raise HTTPException(status_code=400, detail="Only Excel files are supported")
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")
        _latest_workbook = content
        _latest_sheets = _list_sheets(content)
    else:
        content = _latest_workbook
        if content is None:
            raise HTTPException(
                status_code=400,
                detail="No file provided and no cached workbook found. Upload a file first.",
            )

    # Resolve FG Stock export: a new upload wins, else the previously cached one
    fg_stock: pd.DataFrame | None = None
    if fg_stock_file is not None:
        fg_stock = await _parse_fg_stock_upload(fg_stock_file)
        _latest_fg_stock = fg_stock
    else:
        fg_stock = _latest_fg_stock

    try:
        if file is None and _can_use_cached_result(sheet_name, service_level, service_level_mode, service_level_map, lead_time):
            df = _latest_results[sheet_name].copy()
            _latest_result = df.copy()
            _latest_excel = _df_to_excel_bytes(df)
            _latest_service_level = service_level
            _latest_service_level_mode = service_level_mode
            _latest_risk_service_levels = dict(service_level_map) if service_level_map else None
            _latest_lead_time = lead_time
            _latest_intake = _latest_intakes.get(sheet_name)

            customer_analytics = _latest_customer_analytics.get(sheet_name)
            if customer_analytics is None:
                if _latest_intake is not None:
                    customer_analytics = run_customer_analytics(_latest_intake)
                    _latest_customer_analytics[sheet_name] = customer_analytics
                else:
                    with NamedTemporaryFile(suffix=".xlsx") as tmp:
                        tmp.write(content)
                        tmp.flush()
                        intake = load_order_intake(tmp.name, sheet_name=sheet_name)
                    _latest_intakes[sheet_name] = intake.copy()
                    _latest_intake = intake.copy()
                    customer_analytics = run_customer_analytics(intake)
                    _latest_customer_analytics[sheet_name] = customer_analytics
        else:
            df = _run_and_cache(content, sheet_name, service_level, lead_time, service_level_map, fg_stock)
            _latest_service_level = service_level
            _latest_service_level_mode = service_level_mode
            _latest_risk_service_levels = dict(service_level_map) if service_level_map else None
            _latest_lead_time = lead_time

            # Customer analytics were computed inside _run_and_cache
            customer_analytics = _latest_customer_analytics.get(sheet_name)

            if _latest_sheets:
                for other_sheet in _latest_sheets:
                    if other_sheet == sheet_name or other_sheet in _latest_results:
                        continue
                    try:
                        other_df = _run(content, other_sheet, service_level, lead_time, service_level_map, fg_stock)
                        _latest_results[other_sheet] = other_df.copy()
                        with NamedTemporaryFile(suffix=".xlsx") as tmp:
                            tmp.write(content)
                            tmp.flush()
                            other_intake = load_order_intake(tmp.name, sheet_name=other_sheet)
                        self_customer_analytics = run_customer_analytics(other_intake)
                        _latest_customer_analytics[other_sheet] = self_customer_analytics
                    except Exception:
                        continue

        # Persist the run so a backend restart (or a later /recompute-rol Apply)
        # can recover these results from disk without re-running the pipeline.
        _persist_cache()

        return {
            "sheetName": sheet_name,
            "serviceLevel": service_level,
            "serviceLevelMode": service_level_mode,
            "riskServiceLevels": dict(service_level_map) if service_level_map else None,
            "leadTime": lead_time,
            "rows": int(len(df)),
            "columns": list(df.columns),
            "data": df.to_dict(orient="records"),
            "customerAnalytics": customer_analytics,
            "cachedSheets": list(_latest_results.keys()),
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/recompute-rol")
async def recompute_rol(
    sheet_name: str | None = Form(default=None),
    service_level: float = Form(...),
    lead_time: int | None = Form(default=None),
    service_level_mode: str = Form("global"),
    risk_high_external: float = Form(DEFAULT_RISK_SERVICE_LEVELS["High_Risk_External"]),
    risk_low_external: float = Form(DEFAULT_RISK_SERVICE_LEVELS["Low_Risk_External"]),
    risk_medium_external: float = Form(DEFAULT_RISK_SERVICE_LEVELS["Medium_Risk_External"]),
    risk_medium_internal: float = Form(DEFAULT_RISK_SERVICE_LEVELS["Medium_Risk_Internal"]),
) -> dict[str, object]:
    """Recompute only the ROL columns with new service level(s) (fast path).

    ``service_level_mode`` is ``"global"`` (one level for every SKU) or
    ``"risk"`` (per-SKU level from the SKU's Risk_Category). In risk mode the
    four ``risk_*_external/internal`` fields supply the level for each risk
    category; SKUs with any other Risk_Category fall back to ``service_level``.

    Uses the cached pipeline output + cached Order Intake; segmentation
    (ABC/RFM/Risk) is untouched, so any service level(s) can be applied in
    seconds without re-running the full pipeline. If no processed data is
    cached (e.g. the API restarted since the run) it first recovers from the
    disk cache, and as a last resort re-runs the full pipeline from the
    cached workbook so Apply always works.

    Returns the same shape as ``/process`` (rows/columns/data + parameters).
    """
    global _latest_result, _latest_excel, _latest_intake, _latest_fg_stock
    global _latest_service_level, _latest_lead_time
    global _latest_service_level_mode, _latest_risk_service_levels

    if service_level_mode not in ("global", "risk"):
        raise HTTPException(status_code=400, detail="service_level_mode must be 'global' or 'risk'")
    if not (0 < service_level <= 1):
        raise HTTPException(status_code=400, detail="service_level must be between 0 and 1")
    if lead_time is not None and lead_time < 1:
        raise HTTPException(status_code=400, detail="lead_time must be >= 1")

    service_level_map = _build_service_level_map(
        service_level_mode,
        risk_high_external,
        risk_low_external,
        risk_medium_external,
        risk_medium_internal,
    )
    if service_level_map:
        for name, value in service_level_map.items():
            if not (0 < value <= 1):
                raise HTTPException(
                    status_code=400,
                    detail=f"{name} service level must be between 0 and 1",
                )

    # Apply must work even after an API restart: recover from the disk cache
    # first, then (last resort) run the full pipeline from the cached workbook.
    _ensure_recompute_data(sheet_name)

    if sheet_name is not None:
        _latest_result = _latest_results[sheet_name].copy()
        _latest_intake = _latest_intakes[sheet_name].copy()

    try:
        weekly = _build_weekly_from_intake(_latest_intake)

        # Per-SKU lead time, mirroring the pipeline's lead_time_map logic.
        # The intake "Lead Time" column is in DAYS — convert to weeks (÷7) so
        # the safety-stock formula uses weeks; SKUs with no value fall back to
        # the global weeks default.
        lead_time_map: dict[str, float] = {}
        if "Lead Time" in _latest_intake.columns:
            lead_time_map = (
                _latest_intake.groupby("Item_Code")["Lead Time"]
                .agg(lambda x: float(x.mode().iloc[0]) if not x.mode().empty else float(x.median()))
                .div(DAYS_PER_WEEK)  # days -> weeks
                .fillna(float(_latest_lead_time))
                .to_dict()
            )

        df = recompute_rol_columns(
            _latest_result,
            weekly,
            service_level=service_level,
            lead_time=_latest_lead_time if lead_time is None else lead_time,
            lead_time_map=lead_time_map if lead_time_map else None,
            service_level_map=service_level_map,
        )

        # ROL-driven FG Stock columns must track the new service level(s)
        df = enrich_with_fg_stock(df, fg_stock=_latest_fg_stock)

        _latest_result = df.copy()
        if sheet_name is not None:
            _latest_results[sheet_name] = df.copy()
        _latest_excel = _df_to_excel_bytes(df)
        _latest_service_level = service_level
        _latest_service_level_mode = service_level_mode
        _latest_risk_service_levels = dict(service_level_map) if service_level_map else None
        _latest_lead_time = _latest_lead_time if lead_time is None else lead_time
        _persist_cache()

        return {
            "rows": int(len(df)),
            "columns": list(df.columns),
            "data": df.to_dict(orient="records"),
            "serviceLevel": service_level,
            "serviceLevelMode": service_level_mode,
            "riskServiceLevels": dict(service_level_map) if service_level_map else None,
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
    global _latest_service_level_mode, _latest_risk_service_levels, _latest_result

    if _latest_intake is None:
        raise HTTPException(
            status_code=400,
            detail="No intake data cached. Run the pipeline from Overview first.",
        )

    try:
        weekly = _build_weekly_from_intake(_latest_intake)
        # Per-SKU lead time, mirroring the pipeline exactly (truncated to int
        # inside add_rol_columns so the trace always equals the table values).
        # The intake "Lead Time" column is in DAYS — convert to weeks (÷7).
        lead_time = int(_latest_lead_time)
        if "Lead Time" in _latest_intake.columns:
            lt_rows = _latest_intake.loc[_latest_intake["Item_Code"] == item_code, "Lead Time"]
            if not lt_rows.mode().empty:
                lead_time = int(lt_rows.mode().iloc[0] / DAYS_PER_WEEK)

        # Per-SKU service level: in risk mode, resolve from the item's own
        # Risk_Category so the trace always matches the pipeline output.
        service_level = _latest_service_level
        if _latest_risk_service_levels and _latest_result is not None:
            item_row = _latest_result[_latest_result["Item_Code"].astype(str) == str(item_code)]
            if not item_row.empty and "Risk_Category" in item_row.columns:
                risk_cat = str(item_row.iloc[0]["Risk_Category"])
                service_level = _latest_risk_service_levels.get(risk_cat, service_level)

        steps = compute_rol_steps_for_item(
            weekly,
            item_code,
            service_level=service_level,
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
        # Per-SKU lead time, mirroring the pipeline (truncated to int).
        # The intake "Lead Time" column is in DAYS — convert to weeks (÷7).
        lead_time = int(_latest_lead_time)
        if "Lead Time" in _latest_intake.columns:
            lt_rows = _latest_intake.loc[_latest_intake["Item_Code"] == item_code, "Lead Time"]
            if not lt_rows.mode().empty:
                lead_time = int(lt_rows.mode().iloc[0] / DAYS_PER_WEEK)
        points = compute_rol_sensitivity(weekly, item_code, lead_time=lead_time)
        if points is None:
            raise HTTPException(status_code=404, detail=f"Item_Code {item_code} not found in intake data")
        return {"item_code": item_code, "lead_time": lead_time, "points": points}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/download")
def download(format: str = "xlsx") -> StreamingResponse:
    """Download the latest pipeline result as Excel (default) or CSV.

    ``format`` is ``"xlsx"`` (default, same format as pipeline output) or
    ``"csv"``. Both are streamed from the **authoritative in-memory result**
    (``_latest_result`` / ``_latest_excel``), so the export always reflects the
    latest run/recompute — never a stale frontend cache.
    """
    if format not in ("xlsx", "csv"):
        raise HTTPException(status_code=400, detail="format must be 'xlsx' or 'csv'")
    if _latest_result is None:
        raise HTTPException(status_code=404, detail="No generated file found. Call /process first")

    if format == "csv":
        # UTF-8 BOM so Excel renders ₹ (and other non-ASCII) values correctly
        csv_bytes = ("\ufeff" + _latest_result.to_csv(index=False)).encode("utf-8")
        return StreamingResponse(
            BytesIO(csv_bytes),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": "attachment; filename=inventory_pipeline_output.csv"},
        )

    if _latest_excel is None:
        raise HTTPException(status_code=404, detail="No generated file found. Call /process first")

    return StreamingResponse(
        BytesIO(_latest_excel),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=inventory_pipeline_output.xlsx"},
    )


# ---------------------------------------------------------------------------
# Static frontend (production)
# ---------------------------------------------------------------------------
# When a built Vite app exists at ../frontend/dist (i.e. `npm run build` was
# run), serve it from the same FastAPI app. This lets Azure App Service host
# the API and the React dashboard behind a single HTTPS URL — no CORS, one
# link to share with the client. Skipped entirely during local development so
# the API-only dev workflow is unchanged.
#
# NOTE: this catch-all must stay at the END of the file — every API route
# above is registered first so FastAPI matches them before this fallback.

_FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"

if (_FRONTEND_DIST / "index.html").exists():
    app.mount(
        "/assets",
        StaticFiles(directory=_FRONTEND_DIST / "assets"),
        name="assets",
    )

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str) -> FileResponse:
        """Serve the SPA with client-side routing fallback to index.html."""
        candidate = _FRONTEND_DIST / full_path
        # Serve real files (e.g. favicon) directly; otherwise let React Router
        # handle the path (deep links / refresh must return index.html).
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_FRONTEND_DIST / "index.html")
