from __future__ import annotations

from io import BytesIO
from tempfile import NamedTemporaryFile

import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from src.pipeline import InventoryPipeline
from src.utils import ServiceLevelMode, ValidationError

app = FastAPI(title="Inventory Analytics API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_pipeline = InventoryPipeline()
_latest_result: pd.DataFrame | None = None
_latest_excel: bytes | None = None
_latest_workbook: bytes | None = None
_latest_sheets: list[str] | None = None


def _write_output_excel(final_output: pd.DataFrame) -> bytes:
    output_buffer = BytesIO()
    with pd.ExcelWriter(output_buffer, engine="openpyxl") as writer:
        final_output.to_excel(writer, index=False, sheet_name="Final_Output")
    output_buffer.seek(0)
    return output_buffer.getvalue()


def _run_pipeline_from_content(
    content: bytes,
    sheet_name: str,
    service_level_mode: ServiceLevelMode,
    fixed_service_level: float,
):
    with NamedTemporaryFile(suffix=".xlsx") as tmp:
        tmp.write(content)
        tmp.flush()
        sheets = _pipeline.list_sheets(tmp.name)
        artifacts = _pipeline.run(
            tmp.name,
            sheet_name=sheet_name,
            service_level_mode=service_level_mode,
            fixed_service_level=fixed_service_level,
        )
    return sheets, artifacts


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/sheets")
async def upload_and_list_sheets(file: UploadFile = File(...)) -> list[str]:
    global _latest_workbook, _latest_sheets

    if not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Only Excel files are supported")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    try:
        with NamedTemporaryFile(suffix=".xlsx") as tmp:
            tmp.write(content)
            tmp.flush()
            sheets = _pipeline.list_sheets(tmp.name)

        _latest_workbook = content
        _latest_sheets = sheets
        return sheets
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=400, detail=f"Failed to read workbook: {exc}") from exc


@app.get("/sheets")
def list_sheets() -> list[str]:
    if not _latest_sheets:
        raise HTTPException(
            status_code=404,
            detail="No workbook cached. Upload a workbook via POST /sheets or POST /process with file.",
        )
    return _latest_sheets


@app.post("/process")
async def process(
    file: UploadFile | None = File(default=None),
    sheet_name: str = Form(...),
    service_level_mode: ServiceLevelMode = Form("fixed"),
    fixed_service_level: float = Form(85.0),
) -> dict[str, object]:
    global _latest_result, _latest_excel, _latest_workbook, _latest_sheets

    fixed_service_level_ratio = fixed_service_level / 100 if fixed_service_level > 1 else fixed_service_level
    if not (0 < fixed_service_level_ratio <= 1):
        raise HTTPException(
            status_code=400,
            detail="fixed_service_level must be in 0..1 or 0..100 scale",
        )

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
        sheets, artifacts = _run_pipeline_from_content(
            content=content,
            sheet_name=sheet_name,
            service_level_mode=service_level_mode,
            fixed_service_level=fixed_service_level_ratio,
        )
        _latest_sheets = sheets

        _latest_result = artifacts.final_output.copy()
        _latest_excel = _write_output_excel(artifacts.final_output)

        return {
            "sheet_name": sheet_name,
            "service_level_mode": service_level_mode,
            "fixed_service_level": fixed_service_level_ratio,
            "rows": int(len(artifacts.final_output)),
            "columns": list(artifacts.final_output.columns),
            "data": artifacts.final_output.to_dict(orient="records"),
        }
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/product/{item_code}")
def product(item_code: str) -> dict[str, object]:
    if _latest_result is None:
        raise HTTPException(status_code=404, detail="No processed dataset found. Call /process first")

    match = _latest_result[_latest_result["Item_Code"].astype(str) == str(item_code)]
    if match.empty:
        raise HTTPException(status_code=404, detail=f"Item_Code {item_code} not found")

    return match.iloc[0].to_dict()


@app.get("/download")
def download() -> StreamingResponse:
    if _latest_excel is None:
        raise HTTPException(status_code=404, detail="No generated file found. Call /process first")

    return StreamingResponse(
        BytesIO(_latest_excel),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=inventory_pipeline_output.xlsx"},
    )
