from pathlib import Path
import io, zipfile

def _add_dir_to_zip(zf, base_dir: Path, arc_prefix: str):
    if not base_dir.exists():
        return
    for p in base_dir.rglob("*"):
        if p.is_file():
            arcname = f"{arc_prefix}/{p.relative_to(base_dir).as_posix()}"
            zf.write(p, arcname)

def make_zip_bytes(zip_name: str, out_dir: Path, artifacts_dir: Path, extra_logs: dict | None = None) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        _add_dir_to_zip(zf, out_dir, "out_reports")
        _add_dir_to_zip(zf, artifacts_dir, "artifacts")
        if extra_logs:
            import json
            zf.writestr("artifacts/extra_logs.json", json.dumps(extra_logs, ensure_ascii=False, indent=2))
    return buf.getvalue()
