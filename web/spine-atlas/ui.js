(function () {
  "use strict";

  const imageInput = document.getElementById("image-input");
  const atlasInput = document.getElementById("atlas-input");
  const imageName = document.getElementById("image-name");
  const atlasName = document.getElementById("atlas-name");
  const imageDrop = document.getElementById("image-drop");
  const atlasDrop = document.getElementById("atlas-drop");
  const pageWrap = document.getElementById("page-wrap");
  const pageSelect = document.getElementById("page-select");
  const restoreTrim = document.getElementById("restore-trim");
  const unpremultiply = document.getElementById("unpremultiply");
  const exportZip = document.getElementById("export-zip");
  const exportPsd = document.getElementById("export-psd");
  const exportDir = document.getElementById("export-dir");
  const statusEl = document.getElementById("status");
  const warningsEl = document.getElementById("warnings");
  const preview = document.getElementById("preview");
  const previewEmpty = document.getElementById("preview-empty");
  const thumbsEl = document.getElementById("thumbs");
  const thumbsEmpty = document.getElementById("thumbs-empty");
  const regionsEl = document.getElementById("regions");
  const previewCtx = preview.getContext("2d");

  const state = {
    imageFileName: "",
    atlasFileName: "",
    image: null,
    previewSource: null,
    atlas: null,
    pageIndex: 0,
    sprites: [],
    warnings: [],
    selected: 0,
    pageWidth: 0,
    pageHeight: 0,
  };

  const canWriteDir = typeof window.showDirectoryPicker === "function";
  if (!canWriteDir) {
    exportDir.hidden = true;
    document.getElementById("dir-hint").textContent = "当前浏览器不能直接写入文件夹，请用下载的 ZIP。Chrome 或 Edge 通过本机地址打开时可以写入文件夹。";
  }

  bindFileInput(imageInput, "image");
  bindFileInput(atlasInput, "atlas");
  document.getElementById("load-sample").addEventListener("click", loadSample);
  restoreTrim.addEventListener("change", rebuild);
  unpremultiply.addEventListener("change", rebuild);
  pageSelect.addEventListener("change", function () {
    state.pageIndex = Number(pageSelect.value);
    syncPremultiply();
    rebuild();
  });
  exportZip.addEventListener("click", function () { runExport("zip"); });
  exportPsd.addEventListener("click", function () { runExport("psd"); });
  exportDir.addEventListener("click", function () { runExport("dir"); });
  preview.addEventListener("click", onPreviewClick);

  window.addEventListener("resize", function () {
    if (state.previewSource) drawPreview();
  });
  window.addEventListener("dragover", function (event) {
    event.preventDefault();
  });
  window.addEventListener("drop", function (event) {
    event.preventDefault();
    Array.from(event.dataTransfer.files || []).forEach(function (file) {
      routeFile(file, "");
    });
  });

  function bindFileInput(input, preferred) {
    input.addEventListener("change", function () {
      const file = input.files && input.files[0];
      input.value = "";
      if (file) routeFile(file, preferred);
    });
  }

  async function routeFile(file, preferred) {
    let head = "";
    try {
      head = await file.slice(0, 8192).text();
    } catch (error) {
      head = "";
    }
    if (looksLikeBinaryImage(head)) {
      if (preferred === "atlas") {
        setStatus("「" + file.name + "」是图片，已放到图集图片。描述文件请选 .atlas。");
      }
      await loadImageFile(file);
      return;
    }
    if (looksLikeJson(head)) {
      setStatus("「" + file.name + "」是 JSON。拆图要用同目录里的 .atlas 文本，不是骨架 json。");
      return;
    }
    if (looksLikeAtlas(head)) {
      try {
        await loadAtlasText(file.name, await file.text());
      } catch (error) {
        setStatus(error.message || "图集解析失败");
      }
      return;
    }
    if (preferred === "atlas" && isImage(file)) {
      setStatus("「" + file.name + "」是图片，已放到图集图片。描述文件请选 .atlas。");
      await loadImageFile(file);
      return;
    }
    if (isImage(file) || preferred === "image") {
      await loadImageFile(file);
      return;
    }
    setStatus("无法识别「" + file.name + "」。需要一张图集 PNG，以及 Spine 导出的 .atlas。");
  }

  function looksLikeJson(text) {
    const trimmed = text.trim();
    return trimmed.startsWith("{") || trimmed.startsWith("[");
  }

  function looksLikeAtlas(text) {
    return /(^|\n)\s*(bounds|xy|rotate|offsets)\s*:/.test(text);
  }

  function looksLikeBinaryImage(head) {
    if (!head) return false;
    if (head.charCodeAt(0) === 0x89 && head.slice(1, 4) === "PNG") return true;
    if (head.startsWith("GIF8")) return true;
    if (head.charCodeAt(0) === 0xff && head.charCodeAt(1) === 0xd8) return true;
    return head.startsWith("RIFF") && head.slice(8, 12) === "WEBP";
  }

  function isImage(file) {
    return /^image\//.test(file.type) || /\.(png|webp|jpe?g)$/i.test(file.name);
  }

  async function loadImageFile(file) {
    setStatus("正在读取图片…");
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0);
      const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      state.imageFileName = file.name;
      state.image = { width: bitmap.width, height: bitmap.height, data: pixels.data };
      state.previewSource = canvas;
      imageName.textContent = file.name + " · " + bitmap.width + "×" + bitmap.height;
      imageDrop.classList.add("ready");
      choosePage();
      rebuild();
    } catch (error) {
      setStatus(error.message || "图片读取失败");
    }
  }

  async function loadAtlasText(name, text) {
    setStatus("正在读取图集…");
    state.atlas = SpineAtlas.parseAtlas(text);
    state.atlasFileName = name;
    const count = state.atlas.pages.reduce(function (sum, page) { return sum + page.regions.length; }, 0);
    atlasName.textContent = name + " · " + state.atlas.pages.length + " 页 · " + count + " 个区域";
    atlasDrop.classList.add("ready");
    choosePage();
    rebuild();
  }

  function loadSample() {
    const sample = makeSample();
    state.imageFileName = sample.imageName;
    state.atlasFileName = sample.atlasName;
    state.image = sample.image;
    state.atlas = SpineAtlas.parseAtlas(sample.atlasText);
    const canvas = document.createElement("canvas");
    canvas.width = sample.image.width;
    canvas.height = sample.image.height;
    canvas.getContext("2d").putImageData(new ImageData(sample.image.data, sample.image.width, sample.image.height), 0, 0);
    state.previewSource = canvas;
    imageName.textContent = sample.imageName + " · " + sample.image.width + "×" + sample.image.height;
    atlasName.textContent = sample.atlasName;
    imageDrop.classList.add("ready");
    atlasDrop.classList.add("ready");
    choosePage();
    rebuild();
    setStatus("已载入示例。badge 在图集里旋转了 90°，拆出来后应是正的 L。");
  }

  function choosePage() {
    if (!state.atlas) return;
    const matched = SpineAtlas.matchPage(state.atlas.pages, state.imageFileName);
    state.pageIndex = matched >= 0 ? matched : 0;
    pageSelect.innerHTML = "";
    state.atlas.pages.forEach(function (page, index) {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = page.name + "（" + page.regions.length + "）";
      pageSelect.appendChild(option);
    });
    pageSelect.value = String(state.pageIndex);
    pageWrap.hidden = state.atlas.pages.length < 2;
    syncPremultiply();
  }

  function syncPremultiply() {
    const page = currentPage();
    unpremultiply.checked = !!(page && page.pma);
  }

  function currentPage() {
    if (!state.atlas) return null;
    return state.atlas.pages[state.pageIndex] || null;
  }

  function rebuild() {
    warningsEl.innerHTML = "";
    state.sprites = [];
    state.warnings = [];
    const ready = state.image && state.atlas;
    exportZip.disabled = !ready;
    exportPsd.disabled = !ready;
    exportDir.disabled = !ready || !canWriteDir;
    if (!ready) {
      drawPreview();
      if (state.atlas && !state.image) {
        renderAtlasRegions();
        previewEmpty.textContent = "图集描述已读取。请再选择 PNG，预览里才会出现图片。";
        const page = currentPage();
        setStatus("已读取「" + state.atlasFileName + "」，这一页有 " + page.regions.length + " 个区域。再选择图集 PNG 才会拆出图片。");
      } else if (state.image && !state.atlas) {
        renderPieces();
        setStatus("已读取图片「" + state.imageFileName + "」。再选择同目录的 .atlas，只选图片不会拆层。");
      } else {
        renderPieces();
      }
      return;
    }
    try {
      const page = currentPage();
      const result = SpineAtlas.unpackPage(state.image, page, {
        restoreTrim: restoreTrim.checked,
        unpremultiply: unpremultiply.checked,
      });
      state.sprites = result.sprites;
      state.warnings = result.warnings.slice();
      state.pageWidth = result.pageWidth;
      state.pageHeight = result.pageHeight;
      if (state.imageFileName && page.name && SpineAtlas.matchPage(state.atlas.pages, state.imageFileName) !== state.pageIndex) {
        state.warnings.unshift("当前图片文件名和页面「" + page.name + "」不一致，仍按这个页面的区域拆分。");
      }
      if (!state.sprites.length) state.warnings.push("这一页没有可导出的区域。");
      state.selected = Math.min(state.selected, Math.max(0, state.sprites.length - 1));
      const rotated = state.sprites.filter(function (sprite) { return sprite.degrees; }).length;
      setStatus("拆出 " + state.sprites.length + " 个部件" + (rotated ? "，其中 " + rotated + " 个已转回原始方向" : "") + "。");
    } catch (error) {
      state.sprites = [];
      setStatus(error.message || "拆图失败");
    }
    renderWarnings();
    drawPreview();
    renderPieces();
    exportZip.disabled = !state.sprites.length;
    exportPsd.disabled = !state.sprites.length;
    exportDir.disabled = !state.sprites.length || !canWriteDir;
  }

  function renderWarnings() {
    warningsEl.innerHTML = "";
    if (!state.warnings.length) {
      warningsEl.className = "";
      return;
    }
    warningsEl.className = "warnings";
    for (const warning of state.warnings) {
      const p = document.createElement("p");
      p.textContent = warning;
      warningsEl.appendChild(p);
    }
  }

  function drawPreview() {
    if (!state.previewSource) {
      previewEmpty.hidden = false;
      preview.width = 640;
      preview.height = 360;
      previewCtx.clearRect(0, 0, preview.width, preview.height);
      return;
    }
    previewEmpty.hidden = true;
    const source = state.previewSource;
    const maxWidth = Math.max(320, preview.parentElement.clientWidth - 8);
    const scale = Math.min(1, maxWidth / source.width);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    preview.width = Math.max(1, Math.round(source.width * scale * dpr));
    preview.height = Math.max(1, Math.round(source.height * scale * dpr));
    preview.style.width = Math.round(source.width * scale) + "px";
    preview.style.height = Math.round(source.height * scale) + "px";
    previewCtx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    previewCtx.clearRect(0, 0, source.width, source.height);
    previewCtx.drawImage(source, 0, 0);
    state.sprites.forEach(function (sprite, index) {
      const box = sprite.packed;
      const active = index === state.selected;
      previewCtx.lineWidth = active ? 2.5 : 1;
      previewCtx.strokeStyle = active ? "#0f5f5a" : "rgba(138, 75, 18, 0.85)";
      previewCtx.fillStyle = active ? "rgba(15, 95, 90, 0.18)" : "rgba(138, 75, 18, 0.08)";
      previewCtx.fillRect(box.x, box.y, box.width, box.height);
      previewCtx.strokeRect(box.x + 0.5, box.y + 0.5, box.width - 1, box.height - 1);
    });
  }

  function renderAtlasRegions() {
    thumbsEl.innerHTML = "";
    regionsEl.innerHTML = "";
    thumbsEmpty.hidden = false;
    thumbsEmpty.textContent = "区域名单已经列出。选好图集图片后，这里会显示拆出来的图。";
    const page = currentPage();
    if (!page) return;
    page.regions.forEach(function (region) {
      const row = document.createElement("div");
      row.className = "region";
      const title = document.createElement("b");
      title.textContent = region.name;
      const meta = document.createElement("span");
      meta.className = "region-meta";
      meta.textContent = region.x + "," + region.y + " · " + region.width + "×" + region.height +
        (region.degrees ? " · 旋转 " + region.degrees + "°" : "");
      row.appendChild(title);
      row.appendChild(meta);
      regionsEl.appendChild(row);
    });
  }

  function renderPieces() {
    thumbsEl.innerHTML = "";
    regionsEl.innerHTML = "";
    thumbsEmpty.hidden = state.sprites.length > 0;
    const thumbLimit = 80;
    state.sprites.forEach(function (sprite, index) {
      if (index < thumbLimit) thumbsEl.appendChild(thumbButton(sprite, index));
      regionsEl.appendChild(regionButton(sprite, index));
    });
    if (state.sprites.length > thumbLimit) {
      const note = document.createElement("p");
      note.className = "hint";
      note.textContent = "缩略图只显示前 " + thumbLimit + " 个，导出文件包含全部 " + state.sprites.length + " 个。";
      thumbsEl.appendChild(note);
    }
  }

  function thumbButton(sprite, index) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "thumb" + (index === state.selected ? " active" : "");
    const canvas = spriteCanvas(sprite);
    canvas.style.width = "100%";
    canvas.style.height = "72px";
    canvas.style.objectFit = "contain";
    button.appendChild(canvas);
    const title = document.createElement("b");
    title.textContent = sprite.name;
    button.appendChild(title);
    button.addEventListener("click", function () { selectSprite(index); });
    return button;
  }

  function regionButton(sprite, index) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "region" + (index === state.selected ? " active" : "");
    const title = document.createElement("b");
    title.textContent = sprite.name;
    const meta = document.createElement("span");
    meta.className = "region-meta";
    meta.textContent = sprite.packed.x + "," + sprite.packed.y + " · " + sprite.width + "×" + sprite.height +
      (sprite.degrees ? " · 已转回 " + sprite.degrees + "°" : "");
    button.appendChild(title);
    button.appendChild(meta);
    button.addEventListener("click", function () { selectSprite(index); });
    return button;
  }

  function selectSprite(index) {
    state.selected = index;
    drawPreview();
    renderPieces();
    const selected = regionsEl.querySelector(".active");
    if (selected) selected.scrollIntoView({ block: "nearest" });
  }

  function onPreviewClick(event) {
    if (!state.image) return;
    const rect = preview.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * state.image.width;
    const y = ((event.clientY - rect.top) / rect.height) * state.image.height;
    for (let i = state.sprites.length - 1; i >= 0; i--) {
      const box = state.sprites[i].packed;
      if (x >= box.x && y >= box.y && x < box.x + box.width && y < box.y + box.height) {
        selectSprite(i);
        return;
      }
    }
  }

  async function runExport(kind) {
    if (!state.sprites.length) return;
    exportZip.disabled = true;
    exportPsd.disabled = true;
    exportDir.disabled = true;
    try {
      if (kind === "psd") await savePsd();
      else if (kind === "dir") await saveDirectory();
      else await saveZip();
    } catch (error) {
      if (error && error.name === "AbortError") setStatus("已取消选择文件夹。");
      else setStatus(error.message || "导出失败");
    } finally {
      exportZip.disabled = false;
      exportPsd.disabled = false;
      exportDir.disabled = !canWriteDir;
    }
  }

  async function saveZip() {
    setStatus("正在打包 PNG…");
    const folder = folderName();
    const entries = [];
    for (const sprite of state.sprites) {
      const bytes = new Uint8Array(await (await pngBlob(sprite)).arrayBuffer());
      entries.push({ name: folder + "/" + sprite.fileName, bytes: bytes });
    }
    const zip = SpineAtlas.encodeZip(entries);
    download(new Blob([zip], { type: "application/zip" }), folder + ".zip");
    setStatus("已下载 " + folder + ".zip，里面有 " + entries.length + " 张 PNG。");
  }

  async function saveDirectory() {
    setStatus("请选择要写入的文件夹…");
    const root = await window.showDirectoryPicker({ mode: "readwrite" });
    const folder = folderName();
    const dir = await root.getDirectoryHandle(folder, { create: true });
    for (const sprite of state.sprites) {
      const handle = await dir.getFileHandle(sprite.fileName, { create: true });
      const stream = await handle.createWritable();
      await stream.write(await pngBlob(sprite));
      await stream.close();
    }
    setStatus("已写入文件夹「" + folder + "」，共 " + state.sprites.length + " 张 PNG。");
  }

  async function savePsd() {
    setStatus("正在生成 PSD…");
    const layout = SpineAtlas.layoutSprites(state.pageWidth, state.pageHeight, state.sprites);
    const bytes = SpineAtlas.encodePsd(layout.width, layout.height, layout.layers);
    const base = folderName();
    download(new Blob([bytes], { type: "image/vnd.adobe.photoshop" }), base + ".psd");
    const extra = layout.expanded ? "有部件超出页面，画布已扩大。" : "图层按图集位置摆放。";
    setStatus("已下载 " + base + ".psd。" + extra);
  }

  function pngBlob(sprite) {
    return new Promise(function (resolve, reject) {
      spriteCanvas(sprite).toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error("无法编码 " + sprite.fileName));
      }, "image/png");
    });
  }

  function spriteCanvas(sprite) {
    const canvas = document.createElement("canvas");
    canvas.width = sprite.width;
    canvas.height = sprite.height;
    canvas.getContext("2d").putImageData(new ImageData(sprite.data, sprite.width, sprite.height), 0, 0);
    return canvas;
  }

  function folderName() {
    const source = state.imageFileName || state.atlasFileName || "atlas";
    const base = source.split(/[/\\]/).pop().replace(/\.[^.]+$/, "");
    return base.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_") || "atlas";
  }

  function download(blob, filename) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 2000);
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function makeSample() {
    const width = 96;
    const height = 72;
    const data = new Uint8ClampedArray(width * height * 4);
    fillRect(data, width, 0, 0, width, height, [236, 228, 214, 255]);
    fillRect(data, width, 8, 10, 28, 36, [15, 95, 90, 255]);
    fillRect(data, width, 14, 16, 16, 6, [255, 248, 236, 255]);
    fillRect(data, width, 14, 26, 10, 6, [255, 248, 236, 255]);
    const badge = { width: 26, height: 16, data: new Uint8ClampedArray(26 * 16 * 4) };
    fillRect(badge.data, 26, 0, 0, 6, 16, [168, 72, 28, 255]);
    fillRect(badge.data, 26, 0, 10, 26, 6, [168, 72, 28, 255]);
    stampRotated(data, width, badge, 52, 12);
    const atlasText = [
      "sample.png",
      "size: 96, 72",
      "format: RGBA8888",
      "filter: Linear,Linear",
      "repeat: none",
      "mark",
      "  rotate: false",
      "  xy: 8, 10",
      "  size: 28, 36",
      "  orig: 28, 36",
      "  offset: 0, 0",
      "  index: -1",
      "badge",
      "  rotate: 90",
      "  xy: 52, 12",
      "  size: 26, 16",
      "  orig: 26, 16",
      "  offset: 0, 0",
      "  index: -1",
      "",
    ].join("\n");
    return { imageName: "sample.png", atlasName: "sample.atlas", image: { width: width, height: height, data: data }, atlasText: atlasText };
  }

  function stampRotated(dest, destWidth, source, x, y) {
    for (let oy = 0; oy < source.height; oy++) {
      for (let ox = 0; ox < source.width; ox++) {
        const px = oy;
        const py = source.width - 1 - ox;
        const si = (oy * source.width + ox) * 4;
        if (source.data[si + 3] === 0) continue;
        const dx = x + px;
        const dy = y + py;
        const di = (dy * destWidth + dx) * 4;
        dest[di] = source.data[si];
        dest[di + 1] = source.data[si + 1];
        dest[di + 2] = source.data[si + 2];
        dest[di + 3] = source.data[si + 3];
      }
    }
  }

  function fillRect(data, width, x, y, w, h, color) {
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const i = ((y + yy) * width + (x + xx)) * 4;
        data[i] = color[0];
        data[i + 1] = color[1];
        data[i + 2] = color[2];
        data[i + 3] = color[3];
      }
    }
  }
})();
