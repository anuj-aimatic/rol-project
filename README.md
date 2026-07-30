# Inventory Analytics and ROL API

Production-ready Python application that consolidates your notebook logic into modular, reusable classes and exposes the full workflow through FastAPI.

## What It Does

- Reads any selected worksheet from an uploaded workbook
- Preprocesses and validates order intake data
- Runs ABC analysis
- Runs RF analysis
- Builds ABC-RF product segmentation
- Merges segmentation into transactional order data
- Calculates product-level ROL metrics for two service-level policies:
  - Client method: fixed service level (default 85%)
  - ABC-RF method: dynamic service level by segment
- Returns both calculations side-by-side for comparison:
  - `Service_Level_Client`, `Service_Level_ABC_RF`
  - `Safety_Stock_Client`, `Safety_Stock_ABC_RF`
  - `ROL_Client`, `ROL_ABC_RF`
- Also returns selected policy output for API workflow:
  - `Service_Level_Selected`, `Safety_Stock_Selected`, `ROL_Selected`
- Additional demand metrics:
  - Average weekly demand
  - Maximum weekly demand (policy based)
- Returns a final product-level dataset for API consumption

## Project Structure

```text
.
├── api/
│   └── main.py
├── data/
├── notebook/
├── src/
│   ├── abc_analysis.py
│   ├── data_loader.py
│   ├── pipeline.py
│   ├── preprocessing.py
│   ├── rf_analysis.py
│   ├── rol_calculator.py
│   ├── segmentation.py
│   └── utils.py
├── requirements.txt
└── README.md
```

## Setup

1. Create and activate a virtual environment (optional if you already use one).
2. Install dependencies:

```bash
pip install -r requirements.txt
```

## Run API

```bash
uvicorn api.main:app --reload
```

Open API docs:

- Swagger UI: `http://127.0.0.1:8000/docs`
- ReDoc: `http://127.0.0.1:8000/redoc`

## Endpoints

### `POST /process`

Run the full analytics + ROL pipeline.

- Form fields:
  - `file` (Excel, optional if workbook already uploaded/cached)
  - `sheet_name` (required)
  - `service_level_mode` (`fixed` or `dynamic`)
  - `fixed_service_level` (optional; supports `85` or `0.85`)
- Returns JSON with row count, column list, and processed records.

### `POST /sheets`

Upload a workbook and return all available worksheet names.

### `GET /sheets`

Return sheet names from the latest uploaded workbook.

### `GET /product/{item_code}`

Returns one product row from the most recently processed dataset, including:

- `ABC_Class`
- `RF_Category`
- `ABC_RF_Segment`
- `Safety_Stock`
- `ROL`
- `Lead_Time_Weeks`
- Demand and inventory metrics

### `GET /download`

Downloads the most recent processed output as an Excel file.

## Notes

- Business logic is isolated in `src/` and independent from API layer.
- API layer in `api/main.py` only orchestrates request/response handling.
- This design is frontend-ready for future React integration.
- Selected sheet is validated against mandatory columns before processing.
