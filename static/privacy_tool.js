
/**
 * Year-End FastAPI + EXE Project — Step 2 (Robust Reflow)
 */

const enc = new TextEncoder();
const dec = new TextDecoder();
const SALT = "yr-end-enc-salt";

function hexToBytes(hex) {
  if (hex.startsWith("0x")) hex = hex.slice(2);
  if (hex.length % 2 !== 0) throw new Error("Invalid hex length");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function base64urlToBytes(b64url) {
  let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase) {
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(passphrase), { name: "PBKDF2" }, false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode(SALT), iterations: 200000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-CTR", length: 256 },
    false,
    ["encrypt","decrypt"]
  );
}

async function ivFromName(passphrase, name) {
  const key = await crypto.subtle.importKey("raw", enc.encode(passphrase), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(name || ""));
  return new Uint8Array(sig).slice(0, 16);
}

async function decryptENC_whole(token, passphrase, keyCache) {
  const parts = token.split(/[:：]/);
  if (parts.length < 3) throw new Error("ENC token format: ENC:<iv_hex>:<ct_hex>");
  const iv = hexToBytes(parts[1]);
  const ct = hexToBytes(parts[2]);
  const key = keyCache.current || (keyCache.current = await deriveKey(passphrase));
  const pt = await crypto.subtle.decrypt({ name: "AES-CTR", counter: iv, length: 64 }, key, ct);
  return dec.decode(pt);
}

async function decryptFENCb64_whole(token, passphrase, keyCache, nameSeed) {
  const payload = token.replace(/^FENCb64[_-]/i, "");
  const ct = base64urlToBytes(payload);
  const key = keyCache.current || (keyCache.current = await deriveKey(passphrase));
  const iv = await ivFromName(passphrase, nameSeed || token.slice(0,24));
  const pt = await crypto.subtle.decrypt({ name: "AES-CTR", counter: iv, length: 64 }, key, ct);
  return dec.decode(pt);
}

// Inline-decrypt tokens in a line; preserve other text
async function decryptInlineInLine(line, passphrase, keyCache) {
  const encRegex = /ENC[:：]([0-9a-fA-F]+)[:：]([0-9a-fA-F]+)/gi;
  const fencRegex = /FENCb64[_-]([A-Za-z0-9_\-+=/]+)/gi;

  let result = "";
  let idx = 0;
  const matches = [];
  let m;
  while ((m = encRegex.exec(line)) !== null) {
    matches.push({ type: "ENC", start: m.index, end: encRegex.lastIndex, full: m[0] });
  }
  while ((m = fencRegex.exec(line)) !== null) {
    matches.push({ type: "FENC", start: m.index, end: fencRegex.lastIndex, full: m[0] });
  }
  matches.sort((a,b)=>a.start-b.start);

  for (const match of matches) {
    if (match.start > idx) result += line.slice(idx, match.start);
    try {
      if (match.type === "ENC") {
        const decrypted = await decryptENC_whole(match.full, passphrase, keyCache);
        result += decrypted;
      } else {
        const decrypted = await decryptFENCb64_whole(match.full, passphrase, keyCache, match.full.slice(0,24));
        result += decrypted;
      }
    } catch (e) {
      result += "[DECRYPT FAIL] " + match.full;
    }
    idx = match.end;
  }
  result += line.slice(idx);
  return result;
}

// UI: decrypt preview
async function decryptTextarea() {
  const pwd = document.getElementById("pass").value;
  const raw = document.getElementById("enc_in").value.trim();
  if (!pwd || !raw) throw new Error("請輸入密碼與加密文字");

  const keyCache = { current: null };
  const lines = raw.split(/\r?\n/);
  const out = [];
  for (let ln of lines) {
    ln = ln.replace(/[\u200B-\u200D\uFEFF]/g, "");
    if (!ln.trim()) { out.push(""); continue; }
    const replaced = await decryptInlineInLine(ln, pwd, keyCache);
    out.push(replaced);
  }
  const preview = out.join("\n");
  document.getElementById("preview").value = preview;
  return preview;
}

// Robust reflow: split by blanks OR by new token line
async function reflowTwoLine() {
  const pwd = document.getElementById("pass").value;
  const raw = document.getElementById("enc_in").value;
  if (!pwd || !raw.trim()) {
    alert("請先輸入密碼與原始加密文字（上方框）。");
    return;
  }
  const keyCache = { current: null };
  const tokenRawRe = /(ENC[:：][0-9a-fA-F]+[:：][0-9a-fA-F]+)|(FENCb64[_-][A-Za-z0-9_\-+=/]+)/i;
  const tokenRawMulti = /(ENC[:：][0-9a-fA-F]+[:：][0-9a-fA-F]+)|(FENCb64[_-][A-Za-z0-9_\-+=/]+)/gi;
  const lines = raw.split(/\r?\n/);

  const blocks = [];
  let current = null;
  const pushCurrent = () => { if (current && (current.raw.length || current.dec.length)) blocks.push(current); current = null; };

  for (let ln of lines) {
    const blank = ln.trim() === "";
    const hasToken = tokenRawRe.test(ln);
    if (blank) {
      pushCurrent();
      continue;
    }
    if (hasToken) {
      // start a new block whenever a token appears
      pushCurrent();
      current = { raw: [], dec: [] };
    }
    if (!current) current = { raw: [], dec: [] };
    current.raw.push(ln);

    const replaced = await decryptInlineInLine(ln, pwd, keyCache);
    current.dec.push(replaced);
  }
  pushCurrent();

  if (blocks.length === 0) {
    alert("未偵測到內容，請確認上方原始文字。");
    return;
  }

  let noTokenCount = 0;
  const debugNoToken = [];

  const out = [];
  for (const b of blocks) {
    // tokens from RAW
    const rawJoined = b.raw.join("\n");
    const tokens = rawJoined.match(tokenRawMulti) || [];

    let student_key = tokens.length ? tokens[0] : null;
    if (!student_key) {
      const firstLine = b.dec.map(s => s.trim()).find(s => s.length > 0) || "UNKNOWN";
      student_key = "[NO-TOKEN] " + firstLine.slice(0, 64);
      noTokenCount += 1;
      debugNoToken.push(firstLine.slice(0, 60));
    }

    const suggestion = b.dec.join(" ")
      .replace(tokenRawMulti, "")
      .replace(/\s+/g, " ")
      .trim();

    if (suggestion) {
      // If the previous key equals current key, merge suggestion into previous line
      if (out.length >= 2 && out[out.length-2] === student_key) {
        out[out.length-1] = (out[out.length-1] + ' ' + suggestion).replace(/\s+/g, ' ').trim();
      } else {
        out.push(student_key);
        out.push(suggestion);
      }
    }
  }

  document.getElementById("preview").value = out.join("\n");

  if (noTokenCount > 0) {
    console.warn("Blocks without token:", debugNoToken);
    alert("已重排為兩行制；注意：" + noTokenCount + " 個區塊未找到 ENC/FENCb64（已以首行文字暫代）。請打開 Console 查看無 token 區塊的前 60 字以利比對。");
  } else {
    alert("已重排為兩行制（每位學生兩行）。");
  }
}

async function postMerge() {
  const preview = document.getElementById("preview").value.trim();
  if (!preview) throw new Error("請先解密或重排並檢視預覽內容");
  const folder = document.getElementById("folder_path").value || "";
  const mode = document.getElementById("mode").value || "dryrun";

  const fd = new FormData();
  const blob = new Blob([preview], { type: "text/plain;charset=utf-8" });
  fd.append("suggestions", blob, "suggestions.txt");
  fd.append("folder_path", folder);
  fd.append("mode", mode);

  const res = await fetch("/merge", { method: "POST", body: fd });
  if (!res.ok) {
    const t = await res.text();
    throw new Error("Server error: " + t);
  }
  const zipBlob = await res.blob();
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "merge_outputs.zip";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

window.addEventListener("DOMContentLoaded", () => {
  const btnDec = document.getElementById("btn_decrypt");
  const btnSend = document.getElementById("btn_send");
  const btnReflow = document.getElementById("btn_reflow");

  if (btnDec) btnDec.addEventListener("click", async () => {
    try { await decryptTextarea(); alert("預覽已更新。"); }
    catch (e) { alert(e.message || e); }
  });

  if (btnReflow) btnReflow.addEventListener("click", async () => {
    try { await reflowTwoLine(); }
    catch (e) { alert(e.message || e); }
  });

  if (btnSend) btnSend.addEventListener("click", async () => {
    try { await postMerge(); }
    catch (e) { alert(e.message || e); }
  });
});
