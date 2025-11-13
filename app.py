from fastapi import FastAPI, File, UploadFile, Form
from fastapi.responses import StreamingResponse, RedirectResponse, FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi import HTTPException

from pathlib import Path
import io
from utils.merge_logic import run_merge
from utils.zip_utils import make_zip_bytes
from datetime import datetime
app = FastAPI()

# --- Static frontend (already present in your project). Here we only keep minimal placeholders. ---
static_dir = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/")
def root():
    # Redirect to minimal placeholder page if you haven't copied your real HTML yet.
    return RedirectResponse(url="/static/privacy_tool.html")

@app.post("/merge")
async def merge_endpoint(
    suggestions: UploadFile = File(..., description="Decrypted TXT: two-line-per-student"),
    folder_path: str = Form(...),
    mode: str = Form("append")  # append | replace | dryrun
):
    """
    Receives the decrypted TXT, scans folder_path for .docx, applies merge logic,
    writes outputs to local drive (out_reports/, artifacts/), then returns a ZIP.
    """
    # Read TXT bytes
    txt_bytes = await suggestions.read()
    txt_text = txt_bytes.decode("utf-8", errors="replace")

    # Ensure paths
    base_dir = Path(__file__).parent
    out_dir = base_dir / "out_reports"
    art_dir = base_dir / "artifacts"
    out_dir.mkdir(exist_ok=True)
    art_dir.mkdir(exist_ok=True)

    # --- 解析與驗證 folder_path ---
    base_path = Path(folder_path).expanduser().resolve()
    if not base_path.exists():
        raise HTTPException(status_code=400, detail=f"folder_path not found: {base_path}")
    if not base_path.is_dir():
        raise HTTPException(status_code=400, detail=f"folder_path is not a directory: {base_path}")

    # 可選：把收到/解析後的路徑寫入 artifacts 方便稽核
    (base_dir / "artifacts").mkdir(exist_ok=True)
    with open(art_dir / "merge_received_path.txt", "w", encoding="utf-8") as f:
        f.write(f"raw folder_path: {folder_path}\n")
        f.write(f"resolved base_path: {base_path}\n")

    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    result = run_merge(
        suggestions_txt=txt_text,
        folder_path=str(base_path),  # 你現有的 resolved base_path（若未加也可傳 folder_path）
        mode=mode,
        out_dir=out_dir / run_id,
        artifacts_dir=art_dir / run_id,
    )
    zip_bytes = make_zip_bytes(
        zip_name=f"merge_results_{run_id}.zip",
        out_dir=out_dir / run_id,
        artifacts_dir=art_dir / run_id,
        extra_logs=result.get("extra_logs", {}),
    )

    return StreamingResponse(io.BytesIO(zip_bytes), media_type="application/zip", headers={
        "Content-Disposition": 'attachment; filename="merge_results.zip"'
    })
