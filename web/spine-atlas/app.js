(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.SpineAtlas = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function parseAtlas(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const reader = new Reader(text.replace(/^\uFEFF/, ""));
    const entry = new Array(5);
    let line = reader.readLine();
    while (line && line.trim().length === 0) line = reader.readLine();

    while (true) {
      if (!line || line.trim().length === 0) break;
      if (reader.readEntry(entry, line) === 0) break;
      line = reader.readLine();
    }

    const pages = [];
    while (true) {
      if (line === null) break;
      if (line.trim().length === 0) {
        line = reader.readLine();
        continue;
      }
      const page = {
        name: line.trim(),
        width: 0,
        height: 0,
        format: "RGBA8888",
        filter: "",
        repeat: "none",
        pma: false,
        regions: [],
      };
      while (true) {
        if (reader.readEntry(entry, (line = reader.readLine())) === 0) break;
        applyPageField(page, entry);
      }
      while (line !== null && line.trim().length !== 0) {
        const region = blankRegion(page, line.trim());
        while (true) {
          const count = reader.readEntry(entry, (line = reader.readLine()));
          if (count === 0) break;
          applyRegionField(region, entry);
        }
        finishRegion(region);
        page.regions.push(region);
      }
      pages.push(page);
      if (line && line.trim().length === 0) line = reader.readLine();
    }

    if (!pages.length) throw new Error("图集里没有页面");
    return { pages };
  }

  function blankRegion(page, name) {
    return {
      page,
      name,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      offsetX: 0,
      offsetY: 0,
      originalWidth: 0,
      originalHeight: 0,
      degrees: 0,
      index: -1,
    };
  }

  function finishRegion(region) {
    if (!region.width || !region.height) {
      throw new Error("区域「" + region.name + "」缺少有效的 bounds 或 size");
    }
    if (region.originalWidth === 0 && region.originalHeight === 0) {
      region.originalWidth = region.width;
      region.originalHeight = region.height;
    }
  }

  function applyPageField(page, entry) {
    const key = entry[0];
    if (key === "size") {
      page.width = int(entry[1], key);
      page.height = int(entry[2], key);
    } else if (key === "format" && entry[1]) {
      page.format = entry[1];
    } else if (key === "filter") {
      page.filter = [entry[1], entry[2]].filter(Boolean).join(",");
    } else if (key === "repeat" && entry[1]) {
      page.repeat = entry[1];
    } else if (key === "pma") {
      page.pma = entry[1] === "true";
    }
  }

  function applyRegionField(region, entry) {
    const key = entry[0];
    if (key === "xy") {
      region.x = int(entry[1], key);
      region.y = int(entry[2], key);
    } else if (key === "size") {
      region.width = int(entry[1], key);
      region.height = int(entry[2], key);
    } else if (key === "bounds") {
      region.x = int(entry[1], key);
      region.y = int(entry[2], key);
      region.width = int(entry[3], key);
      region.height = int(entry[4], key);
    } else if (key === "offset") {
      region.offsetX = int(entry[1], key);
      region.offsetY = int(entry[2], key);
    } else if (key === "orig") {
      region.originalWidth = int(entry[1], key);
      region.originalHeight = int(entry[2], key);
    } else if (key === "offsets") {
      region.offsetX = int(entry[1], key);
      region.offsetY = int(entry[2], key);
      region.originalWidth = int(entry[3], key);
      region.originalHeight = int(entry[4], key);
    } else if (key === "rotate") {
      region.degrees = parseDegrees(entry[1], region.name);
    } else if (key === "index") {
      region.index = int(entry[1], key);
    }
  }

  function int(value, key) {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error("字段 " + key + " 的数字无效：" + value);
    return n | 0;
  }

  function parseDegrees(value, name) {
    if (value === "true") return 90;
    if (value === "false" || value == null || value === "") return 0;
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error("区域「" + name + "」的旋转无法识别：" + value);
    const d = ((n % 360) + 360) % 360;
    if (d === 0 || d === 90 || d === 180 || d === 270) return d;
    throw new Error("区域「" + name + "」的旋转只支持 0、90、180、270 度");
  }

  function Reader(text) {
    this.lines = text.split(/\r\n|\r|\n/);
    this.index = 0;
  }

  Reader.prototype.readLine = function () {
    if (this.index >= this.lines.length) return null;
    return this.lines[this.index++];
  };

  Reader.prototype.readEntry = function (entry, line) {
    if (!line) return 0;
    line = line.trim();
    if (!line.length) return 0;
    const colon = line.indexOf(":");
    if (colon === -1) return 0;
    entry[0] = line.slice(0, colon).trim();
    for (let i = 1, last = colon + 1; ; i++) {
      const comma = line.indexOf(",", last);
      if (comma === -1) {
        entry[i] = line.slice(last).trim();
        return i;
      }
      entry[i] = line.slice(last, comma).trim();
      last = comma + 1;
      if (i === 4) return 4;
    }
  };

  function packedRect(region) {
    if (region.degrees === 90) {
      return { x: region.x, y: region.y, width: region.height, height: region.width };
    }
    return { x: region.x, y: region.y, width: region.width, height: region.height };
  }

  function crop(image, x, y, w, h) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row++) {
      const src = ((y + row) * image.width + x) * 4;
      data.set(image.data.subarray(src, src + w * 4), row * w * 4);
    }
    return { width: w, height: h, data };
  }

  function unrotate(image, degrees) {
    if (degrees === 0) return image;
    if (degrees === 180) {
      const data = new Uint8ClampedArray(image.data.length);
      const w = image.width;
      const h = image.height;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const si = (y * w + x) * 4;
          const di = ((h - 1 - y) * w + (w - 1 - x)) * 4;
          data[di] = image.data[si];
          data[di + 1] = image.data[si + 1];
          data[di + 2] = image.data[si + 2];
          data[di + 3] = image.data[si + 3];
        }
      }
      return { width: w, height: h, data };
    }
    const src = image;
    const dstW = src.height;
    const dstH = src.width;
    const data = new Uint8ClampedArray(dstW * dstH * 4);
    for (let py = 0; py < src.height; py++) {
      for (let px = 0; px < src.width; px++) {
        const ox = degrees === 90 ? src.height - 1 - py : py;
        const oy = degrees === 90 ? px : src.width - 1 - px;
        const si = (py * src.width + px) * 4;
        const di = (oy * dstW + ox) * 4;
        data[di] = src.data[si];
        data[di + 1] = src.data[si + 1];
        data[di + 2] = src.data[si + 2];
        data[di + 3] = src.data[si + 3];
      }
    }
    return { width: dstW, height: dstH, data };
  }

  function unpremultiply(data) {
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a === 0 || a === 255) continue;
      data[i] = Math.min(255, Math.round((data[i] * 255) / a));
      data[i + 1] = Math.min(255, Math.round((data[i + 1] * 255) / a));
      data[i + 2] = Math.min(255, Math.round((data[i + 2] * 255) / a));
    }
  }

  function blit(width, height, sprite, x, y) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < sprite.height; row++) {
      const dy = y + row;
      if (dy < 0 || dy >= height) continue;
      for (let col = 0; col < sprite.width; col++) {
        const dx = x + col;
        if (dx < 0 || dx >= width) continue;
        const si = (row * sprite.width + col) * 4;
        const di = (dy * width + dx) * 4;
        data[di] = sprite.data[si];
        data[di + 1] = sprite.data[si + 1];
        data[di + 2] = sprite.data[si + 2];
        data[di + 3] = sprite.data[si + 3];
      }
    }
    return { width, height, data };
  }

  function unpackPage(image, page, options) {
    const opts = options || {};
    const warnings = [];
    const sprites = [];
    const used = new Set();
    const pageWidth = page.width || image.width;
    const pageHeight = page.height || image.height;
    if (page.width && page.height && (page.width !== image.width || page.height !== image.height)) {
      warnings.push(
        "图集记录的页面尺寸是 " +
          page.width +
          "×" +
          page.height +
          "，图片实际是 " +
          image.width +
          "×" +
          image.height
      );
    }
    for (const region of page.regions) {
      const packed = packedRect(region);
      if (
        packed.width <= 0 ||
        packed.height <= 0 ||
        packed.x < 0 ||
        packed.y < 0 ||
        packed.x + packed.width > image.width ||
        packed.y + packed.height > image.height
      ) {
        warnings.push("已跳过超出图片的区域「" + region.name + "」");
        continue;
      }
      let sprite = unrotate(crop(image, packed.x, packed.y, packed.width, packed.height), region.degrees);
      if (opts.unpremultiply) unpremultiply(sprite.data);
      let left = packed.x;
      let top = packed.y;
      if (opts.restoreTrim) {
        const origW = region.originalWidth || sprite.width;
        const origH = region.originalHeight || sprite.height;
        const offsetTop = origH - region.offsetY - sprite.height;
        left = packed.x - region.offsetX;
        top = packed.y - offsetTop;
        sprite = blit(origW, origH, sprite, region.offsetX, offsetTop);
      }
      sprites.push({
        name: region.name,
        fileName: uniqueFileName(region, used),
        index: region.index,
        degrees: region.degrees,
        packed,
        left,
        top,
        width: sprite.width,
        height: sprite.height,
        data: sprite.data,
      });
    }
    return { warnings, sprites, pageWidth, pageHeight };
  }

  function uniqueFileName(region, used) {
    let base = region.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() || "region";
    if (base.length > 80) base = base.slice(0, 80);
    if (region.index >= 0) base += "_" + region.index;
    let name = base;
    let n = 2;
    while (used.has(name.toLowerCase())) name = base + "_" + n++;
    used.add(name.toLowerCase());
    return name + ".png";
  }

  function layoutSprites(pageWidth, pageHeight, sprites) {
    let minX = 0;
    let minY = 0;
    let maxX = pageWidth;
    let maxY = pageHeight;
    for (const sprite of sprites) {
      minX = Math.min(minX, sprite.left);
      minY = Math.min(minY, sprite.top);
      maxX = Math.max(maxX, sprite.left + sprite.width);
      maxY = Math.max(maxY, sprite.top + sprite.height);
    }
    const shiftX = -minX;
    const shiftY = -minY;
    return {
      width: maxX - minX,
      height: maxY - minY,
      expanded: minX < 0 || minY < 0 || maxX > pageWidth || maxY > pageHeight,
      layers: sprites.map(function (sprite) {
        return {
          name: sprite.name,
          left: sprite.left + shiftX,
          top: sprite.top + shiftY,
          width: sprite.width,
          height: sprite.height,
          data: sprite.data,
        };
      }),
    };
  }

  function composite(width, height, layers) {
    const dst = new Uint8ClampedArray(width * height * 4);
    for (const layer of layers) {
      for (let y = 0; y < layer.height; y++) {
        const dy = layer.top + y;
        if (dy < 0 || dy >= height) continue;
        for (let x = 0; x < layer.width; x++) {
          const dx = layer.left + x;
          if (dx < 0 || dx >= width) continue;
          const si = (y * layer.width + x) * 4;
          const sa = layer.data[si + 3];
          if (sa === 0) continue;
          const di = (dy * width + dx) * 4;
          if (sa === 255) {
            dst[di] = layer.data[si];
            dst[di + 1] = layer.data[si + 1];
            dst[di + 2] = layer.data[si + 2];
            dst[di + 3] = 255;
            continue;
          }
          const da = dst[di + 3];
          const outA = sa + Math.round((da * (255 - sa)) / 255);
          if (!outA) continue;
          dst[di] = Math.round((layer.data[si] * sa + dst[di] * da * (255 - sa) / 255) / outA);
          dst[di + 1] = Math.round((layer.data[si + 1] * sa + dst[di + 1] * da * (255 - sa) / 255) / outA);
          dst[di + 2] = Math.round((layer.data[si + 2] * sa + dst[di + 2] * da * (255 - sa) / 255) / outA);
          dst[di + 3] = outA;
        }
      }
    }
    return dst;
  }

  function rlePack(row) {
    const out = [];
    let i = 0;
    while (i < row.length) {
      let run = 1;
      while (i + run < row.length && row[i] === row[i + run] && run < 128) run++;
      if (run >= 2) {
        out.push(257 - run, row[i]);
        i += run;
        continue;
      }
      let j = i + 1;
      while (j < row.length && j - i < 128) {
        if (j + 1 < row.length && row[j] === row[j + 1]) break;
        j++;
      }
      const count = j - i;
      out.push(count - 1);
      for (let k = 0; k < count; k++) out.push(row[i + k]);
      i += count;
    }
    return Uint8Array.from(out);
  }

  function rleUnpack(packed, length) {
    const out = new Uint8Array(length);
    let i = 0;
    let o = 0;
    while (o < length) {
      let n = packed[i++];
      if (n > 127) n -= 256;
      if (n >= 0) {
        const count = n + 1;
        out.set(packed.subarray(i, i + count), o);
        i += count;
        o += count;
      } else if (n !== -128) {
        const count = 1 - n;
        out.fill(packed[i++], o, o + count);
        o += count;
      }
    }
    return out;
  }

  function encodeChannel(plane, width, height) {
    const rows = [];
    for (let y = 0; y < height; y++) rows.push(rlePack(plane.subarray(y * width, (y + 1) * width)));
    const out = new Uint8Array(2 + height * 2 + rows.reduce(function (n, row) { return n + row.length; }, 0));
    const view = new DataView(out.buffer);
    view.setUint16(0, 1);
    let offset = 2;
    for (const row of rows) {
      view.setUint16(offset, row.length);
      offset += 2;
    }
    for (const row of rows) {
      out.set(row, offset);
      offset += row.length;
    }
    return out;
  }

  function plane(data, width, height, channel) {
    const out = new Uint8Array(width * height);
    for (let i = 0; i < out.length; i++) out[i] = data[i * 4 + channel];
    return out;
  }

  function pascalName(name) {
    let ascii = "";
    for (const ch of name) {
      const code = ch.codePointAt(0);
      ascii += code >= 32 && code <= 126 ? ch : "?";
      if (ascii.length >= 255) break;
    }
    if (!ascii) ascii = "layer";
    const bytes = [ascii.length];
    for (let i = 0; i < ascii.length; i++) bytes.push(ascii.charCodeAt(i));
    while (bytes.length % 4 !== 0) bytes.push(0);
    return Uint8Array.from(bytes);
  }

  function luniBlock(name) {
    const units = [];
    for (let i = 0; i < name.length; i++) units.push(name.charCodeAt(i));
    const payload = 4 + units.length * 2;
    const out = new Uint8Array(4 + 4 + 4 + payload);
    out.set(ascii("8BIMluni"), 0);
    const view = new DataView(out.buffer);
    view.setUint32(8, payload);
    view.setUint32(12, units.length);
    for (let i = 0; i < units.length; i++) view.setUint16(16 + i * 2, units[i]);
    return out;
  }

  function ascii(text) {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
    return out;
  }

  function u16(n) {
    const out = new Uint8Array(2);
    new DataView(out.buffer).setUint16(0, n);
    return out;
  }

  function u32(n) {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, n >>> 0);
    return out;
  }

  function i16(n) {
    const out = new Uint8Array(2);
    new DataView(out.buffer).setInt16(0, n);
    return out;
  }

  function i32(n) {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setInt32(0, n | 0);
    return out;
  }

  function concat(parts) {
    let size = 0;
    for (const part of parts) size += part.length;
    const out = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  function encodePsd(width, height, layers) {
    if (width <= 0 || height <= 0 || width > 30000 || height > 30000) {
      throw new Error("PSD 画布尺寸无效：" + width + "×" + height);
    }
    const merged = composite(width, height, layers);
    const layerRecords = [];
    const channelBlobs = [];
    for (const layer of layers) {
      const channels = [
        encodeChannel(plane(layer.data, layer.width, layer.height, 3), layer.width, layer.height),
        encodeChannel(plane(layer.data, layer.width, layer.height, 0), layer.width, layer.height),
        encodeChannel(plane(layer.data, layer.width, layer.height, 1), layer.width, layer.height),
        encodeChannel(plane(layer.data, layer.width, layer.height, 2), layer.width, layer.height),
      ];
      const ids = [-1, 0, 1, 2];
      const extra = concat([u32(0), u32(0), pascalName(layer.name), luniBlock(layer.name)]);
      const record = [i32(layer.top), i32(layer.left), i32(layer.top + layer.height), i32(layer.left + layer.width), u16(4)];
      for (let i = 0; i < 4; i++) record.push(i16(ids[i]), u32(channels[i].length));
      record.push(ascii("8BIMnorm"), new Uint8Array([255, 0, 0, 0]), u32(extra.length), extra);
      layerRecords.push(concat(record));
      channelBlobs.push(concat(channels));
    }
    let layerInfo = concat([i16(layers.length)].concat(layerRecords, channelBlobs));
    if (layerInfo.length % 2) layerInfo = concat([layerInfo, new Uint8Array(1)]);
    const section = concat([u32(layerInfo.length), layerInfo, u32(0)]);
    const imageRows = [];
    for (let channel = 0; channel < 4; channel++) {
      const values = plane(merged, width, height, channel);
      for (let y = 0; y < height; y++) imageRows.push(rlePack(values.subarray(y * width, (y + 1) * width)));
    }
    const imageCounts = [];
    for (const row of imageRows) imageCounts.push(u16(row.length));
    const imageData = concat([u16(1)].concat(imageCounts, imageRows));
    return concat([
      ascii("8BPS"),
      u16(1),
      new Uint8Array(6),
      u16(4),
      u32(height),
      u32(width),
      u16(8),
      u16(3),
      u32(0),
      u32(0),
      u32(section.length),
      section,
      imageData,
    ]);
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function dosStamp(date) {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, day };
  }

  function le16(n) {
    const out = new Uint8Array(2);
    new DataView(out.buffer).setUint16(0, n, true);
    return out;
  }

  function le32(n) {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, n >>> 0, true);
    return out;
  }

  function encodeZip(entries, date) {
    const stamp = dosStamp(date || new Date());
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const entry of entries) {
      const name = new TextEncoder().encode(entry.name);
      const bytes = entry.bytes;
      const crc = crc32(bytes);
      const local = concat([
        le32(0x04034b50),
        le16(20),
        le16(0x0800),
        le16(0),
        le16(stamp.time),
        le16(stamp.day),
        le32(crc),
        le32(bytes.length),
        le32(bytes.length),
        le16(name.length),
        le16(0),
        name,
        bytes,
      ]);
      const central = concat([
        le32(0x02014b50),
        le16(20),
        le16(20),
        le16(0x0800),
        le16(0),
        le16(stamp.time),
        le16(stamp.day),
        le32(crc),
        le32(bytes.length),
        le32(bytes.length),
        le16(name.length),
        le16(0),
        le16(0),
        le16(0),
        le16(0),
        le32(0),
        le32(offset),
        name,
      ]);
      locals.push(local);
      centrals.push(central);
      offset += local.length;
    }
    const centralDir = concat(centrals);
    const end = concat([
      le32(0x06054b50),
      le16(0),
      le16(0),
      le16(entries.length),
      le16(entries.length),
      le32(centralDir.length),
      le32(offset),
      le16(0),
    ]);
    return concat(locals.concat([centralDir, end]));
  }

  function matchPage(pages, imageName) {
    const base = String(imageName || "").split(/[/\\]/).pop().toLowerCase();
    return pages.findIndex(function (page) {
      const name = page.name.split(/[/\\]/).pop().toLowerCase();
      return name === base;
    });
  }

  function selfTest() {
    function assert(cond, message) {
      if (!cond) throw new Error(message || "assertion failed");
    }

    const atlas = parseAtlas(
      "coin.png\n" +
        "\tsize: 32, 16\n" +
        "\tformat: RGBA8888\n" +
        "\tfilter: Linear, Linear\n" +
        "\trepeat: none\n" +
        "face\n" +
        "\tbounds: 1, 2, 4, 3\n" +
        "\toffsets: 1, 1, 6, 5\n" +
        "edge\n" +
        "\tbounds: 8, 1, 2, 2\n" +
        "\trotate: 90\n" +
        "\tindex: -1\n\n" +
        "second.png\n" +
        "\tsize: 8, 8\n" +
        "dot\n" +
        "\txy: 0, 0\n" +
        "\tsize: 1, 1\n" +
        "\trotate: false\n"
    );
    assert(atlas.pages.length === 2, "page count");
    assert(atlas.pages[0].regions[0].offsetX === 1 && atlas.pages[0].regions[0].originalHeight === 5, "offsets");
    assert(atlas.pages[0].regions[1].degrees === 90, "rotate 90");
    assert(atlas.pages[1].regions[0].name === "dot", "second page");
    assert(matchPage(atlas.pages, "folder/coin.png") === 0, "match page");

    const image = { width: 16, height: 8, data: new Uint8ClampedArray(16 * 8 * 4) };
    function put(x, y, r, g, b, a) {
      const i = (y * 16 + x) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = a == null ? 255 : a;
    }
    put(1, 2, 10, 0, 0);
    put(2, 2, 20, 0, 0);
    put(3, 2, 30, 0, 0);
    put(4, 2, 40, 0, 0);
    put(1, 3, 50, 0, 0);
    put(2, 3, 60, 0, 0);
    put(3, 3, 70, 0, 0);
    put(4, 3, 80, 0, 0);
    put(1, 4, 90, 0, 0);
    put(2, 4, 100, 0, 0);
    put(3, 4, 110, 0, 0);
    put(4, 4, 120, 0, 0);
    // Original 2x2 [1 2; 3 4], stored rotated 90 CCW at (8, 1): [2 4; 1 3]
    put(8, 1, 2, 0, 0);
    put(9, 1, 4, 0, 0);
    put(8, 2, 1, 0, 0);
    put(9, 2, 3, 0, 0);

    const unpacked = unpackPage(image, atlas.pages[0], { restoreTrim: false });
    assert(unpacked.sprites.length === 2, "sprite count");
    assert(unpacked.sprites[0].data[0] === 10, "face origin is top-left");
    const edge = unpacked.sprites[1];
    assert(edge.width === 2 && edge.height === 2, "unrotated size");
    assert(edge.data[0] === 1 && edge.data[4] === 2 && edge.data[8] === 3 && edge.data[12] === 4, "unrotate 90");

    const trimmed = unpackPage(image, atlas.pages[0], { restoreTrim: true }).sprites[0];
    assert(trimmed.width === 6 && trimmed.height === 5, "orig size");
    const pix = (x, y) => trimmed.data[(y * 6 + x) * 4];
    assert(pix(1, 1) === 10 && pix(4, 3) === 120 && pix(0, 0) === 0 && pix(1, 4) === 0, "whitespace offset");

    const packed = rlePack(Uint8Array.from([0, 0, 0, 0, 7, 8, 9]));
    const round = rleUnpack(packed, 7);
    assert(round.join(",") === "0,0,0,0,7,8,9", "rle");
    assert(crc32(ascii("123456789")) === 0xcbf43926, "crc");

    const psd = encodePsd(16, 8, layoutSprites(16, 8, unpacked.sprites).layers);
    assert(asciiText(psd.subarray(0, 4)) === "8BPS", "psd signature");
    const zip = encodeZip([{ name: "a.png", bytes: ascii("hi") }], new Date(2026, 0, 2, 3, 4, 6));
    assert(zip[0] === 0x50 && zip[1] === 0x4b, "zip signature");
  }

  function asciiText(bytes) {
    let text = "";
    for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
    return text;
  }

  return {
    parseAtlas,
    unpackPage,
    layoutSprites,
    encodePsd,
    encodeZip,
    matchPage,
    packedRect,
    selfTest,
  };
});

if (typeof module !== "undefined" && require.main === module) {
  module.exports.selfTest();
  console.log("selfTest passed");
}
