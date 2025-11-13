/* Step 1: minimal front-end that posts multipart/form-data to /merge */
async function postMerge() {
  const txt = document.getElementById("suggestions").value || "";
  const folderPath = document.getElementById("folder_path").value || "";
  const mode = document.getElementById("mode").value || "append";

  const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
  // Name the file for server-side visibility
  const file = new File([blob], "suggestions.txt", { type: "text/plain" });

  const fd = new FormData();
  fd.append("suggestions", file, "suggestions.txt");
  fd.append("folder_path", folderPath);
  fd.append("mode", mode);

  const respEl = document.getElementById("resp");
  respEl.textContent = "送出中...";

  try {
    const res = await fetch("/merge", {
      method: "POST",
      body: fd,
    });
    const json = await res.json();
    respEl.textContent = JSON.stringify(json, null, 2);
  } catch (err) {
    respEl.textContent = "發生錯誤：" + (err && err.message ? err.message : String(err));
  }
}

document.getElementById("btn-merge").addEventListener("click", postMerge);