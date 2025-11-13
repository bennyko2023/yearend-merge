from pathlib import Path
from typing import Dict, List, Tuple
import csv, re, time, hashlib
from utils.docx_tools import open_docx, save_docx, append_suggestions_end, replace_text_in_textboxes_xml
import os

def _scan_docx_files(root: Path) -> List[Path]:
    return [p for p in root.rglob("*") if p.is_file() and p.suffix.lower()==".docx"]

def _parse_two_line_txt(txt: str) -> List[Tuple[str, str]]:
    """
    Parse two-line-per-student TXT:
    line1 = student key (ENC token or name)
    line2 = suggestion paragraph
    Ignore blank lines.
    """
    lines = [ln.rstrip("\n\r") for ln in txt.splitlines() if ln.strip()!=""]
    pairs = []
    i = 0
    while i < len(lines)-1:
        key = lines[i].strip()
        val = lines[i+1].strip()
        pairs.append((key, val))
        i += 2
    return pairs

def _match_doc_for_key(key: str, files: List[Path]) -> Path | None:
    key_lower = key.lower()
    for f in files:
        if key_lower in f.name.lower():
            return f
    # Optional: search inside doc for 「學生姓名：」 then match (skipped for speed here)
    return None

def _safe_stem_hash(p: Path) -> str:
    return hashlib.sha1(p.name.encode("utf-8")).hexdigest()[:8]

def run_merge(suggestions_txt: str, folder_path: str, mode: str, out_dir: Path, artifacts_dir: Path) -> Dict:
    start_ts = time.time()

    # A. 定錨 + 受控掃描
    base = Path(folder_path).expanduser().resolve()
    if not base.exists() or not base.is_dir():
        raise RuntimeError(f"invalid folder_path: {base}")

    def _is_under(child: Path, parent: Path) -> bool:
        c = Path(child).resolve(); p = Path(parent).resolve()
        return str(c).lower().startswith(str(p).lower())

    files: list[Path] = []
    for r, _, fs in os.walk(base):
        for fn in fs:
            if fn.lower().endswith(".docx"):
                p = Path(r, fn).resolve()
                if _is_under(p, base):
                    files.append(p)

    pairs = _parse_two_line_txt(suggestions_txt)

    artifacts_dir.mkdir(exist_ok=True, parents=True)
    out_dir.mkdir(exist_ok=True, parents=True)
    summary_csv = artifacts_dir / "processing_summary.csv"
    log_path = artifacts_dir / "merge_log.txt"

    with open(artifacts_dir / "scanned_docx_list.txt", "w", encoding="utf-8") as fscan:
        for p in files: fscan.write(str(p) + "\n")

    rows, logs = [], []
    total_written = 0

    for key, paragraph in pairs:
        matched = _match_doc_for_key(key, files)  # 僅從 files 選；確保函式不外搜
        if not matched:
            rows.append([key, "", mode, "not_found", "No matching .docx by filename"])
            logs.append(f"[WARN] {key} → no match")
            continue

        if not _is_under(matched, base):
            rows.append([key, str(matched), mode, "skipped_out_of_base", "matched outside base"])
            logs.append(f"[SKIP] outside base: {matched}")
            continue

        if mode == "dryrun":
            rows.append([key, matched.name, mode, "dryrun", "no write in dryrun mode"])
            logs.append(f"[DRYRUN] {key} -> {matched.name}")
            continue

        heading = "建議（多版本）："
        replaced, new_bytes = replace_text_in_textboxes_xml(matched, "建議", paragraph)
        out_file = out_dir / matched.name

        if mode == "replace":
            if replaced and new_bytes is not None:
                out_file_tmp = out_dir / (matched.stem + "._tmp.docx")
                out_file_tmp.write_bytes(new_bytes)
                doc = open_docx(out_file_tmp)
                save_docx(doc, out_file)
                out_file_tmp.unlink(missing_ok=True)

                rows.append([key, matched.name, mode, "textbox_or_heading_replaced", "Replaced then restyled"])
                logs.append(f"[OK] replaced+restyled: {matched.name}")
                total_written += 1
                continue

        # mode == "append"
        doc = open_docx(matched)
        append_suggestions_end(doc, heading, paragraph)
        save_docx(doc, out_file)
        rows.append([key, matched.name, mode, "appended", "Appended at end"])
        logs.append(f"[OK] appended: {matched.name}")
        total_written += 1

    # Write CSV
    with open(summary_csv, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["student_key", "filename", "mode", "result", "message"])
        for r in rows:
            w.writerow(r)

    # Write log
    with open(log_path, "w", encoding="utf-8") as f:
        f.write("\n".join(logs))
        duration = time.time() - start_ts
        f.write(f"\n-- processed {len(pairs)} suggestions, written={total_written}, elapsed={duration:.2f}s\n")

    return {
        "count_pairs": len(pairs),
        "written": total_written,
        "summary_csv": str(summary_csv),
        "log": str(log_path),
        "extra_logs": {"elapsed_sec": f"{time.time()-start_ts:.2f}"}
    }
def make_zip_bytes(zip_name: str, out_dir: Path, artifacts_dir: Path, extra_logs: dict):
    import zipfile, io
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # 只收本輪 out_dir + artifacts_dir
        for root in [out_dir, artifacts_dir]:
            if root.exists():
                for p in root.rglob("*"):
                    if p.is_file():
                        arcname = str(Path(root.name) / p.relative_to(root))
                        zf.write(p, arcname)
    return buf.getvalue()
