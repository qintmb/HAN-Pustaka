# GOAL
Offline-first PDF flipbook clone of kubil-ismail/Pdf-Flipbook:
- Bookshelf landing page with history (books on shelf)
- Drag-drop PDF → open in flipbook lightbox
- Flip effect (WebGL page curl), sound, thumbnails, zoom
- IndexedDB history: file blob, metadata, last page, zoom, annotations
- All assets vendored locally (no CDN)

# STEPS
1. **Vendor assets** from ref repo:
   - `vendor/js/`: jquery-1.8.3.min.js, jquery-ui-1.9.2.min.js, flipbook.min.js, flipbook.webgl.min.js, flipbook.swipe.min.js, flipbook.book3.min.js, flipbook.pdfservice.min.js, iscroll.min.js, pdf.min.js (v2.6.2), pdf.worker.min.js, three.min.js
   - `vendor/css/`: flipbook.style.css, font-awesome.css
   - `vendor/webfonts/`: FontAwesome fonts
   - `vendor/images/`: preloader.jpg, overlay.png, spinner.gif, shelf_glass.png, shelf_wood.png, shelf_metal.png, Transparent.png
   - `vendor/mp3/`: turnPage.mp3, turnPage.ogg
   - `sounds/` (existing): keep turnPage.mp3/.ogg

2. **index.html** - bookshelf landing:
   - Drop zone + file input
   - History grid (books on shelf, thumb = page 1 render)
   - Load local vendor scripts/styles
   - Lightbox container for flipbook

3. **app.js** (ES module):
   - `HistoryDB` wrapper over idb.min.js: store `books` (key=id=sha256, value={id,name,size,blob,addedAt,lastPage,zoom,annotations,thumbDataUrl})
   - `sha256(arrayBuffer)` via crypto.subtle
   - `PDFThumb.renderFirstPage(blob)` → dataURL for shelf thumb
   - On drop: save to HistoryDB, add to shelf, open flipbook
   - Flipbook init: `lightBox:true`, `pdfUrl: blobURL`, assets paths to vendor/, events: `pagechange` → save lastPage/zoom to DB
   - Annotations: simple overlay layer (DOM) per page, saved to DB

4. **styles.css** - merged flipbook.style.css + custom bookshelf/dropzone styles

5. **Test**: `python3 -m http.server` → open, drop test.pdf, flip pages, refresh → history persists

# FILES
- index.html (new)
- app.js (new)
- styles.css (new)
- vendor/js/* (12 files)
- vendor/css/* (2 files)
- vendor/webfonts/* (12 files)
- vendor/images/* (7 files)
- vendor/mp3/* (2 files)
- sounds/turnPage.mp3, turnPage.ogg (existing)
- idb.min.js (existing)

# NOTES
- Use ref's pdf.min.js v2.6.2 (old API) — NOT pdfjs-dist@6.5.438 (modern ESM incompatible with flipbook plugin)
- jQuery 1.8.3 + jQuery UI 1.9.2 required (plugin uses $.fn.flipBook, draggable, etc.)
- IndexedDB on file:// works in Chrome; Safari needs http(s). Serve via `python3 -m http.server 8080`
- Flipbook events: `model.on("pagechange", fn)` or `model.on("zoomStart/End", fn)` — bind via plugin's model
- Annotations MVP: per-page array of `{page, x, y, w, h, type:"rect|text", color, text}` rendered as overlay divs over book container