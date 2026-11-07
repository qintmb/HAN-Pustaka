# HAN-Pustaka Design Specification

## Intent & Why
A single-file, offline-first web app for viewing PDFs as flipbooks with three distinct modes:
- **Book mode** (RTL): Right-to-left page flip for books/manga (Arabic, Japanese)
- **Comic mode** (LTR): Left-to-right page flip for Western comics
- **Calendar mode**: Bottom-to-top flip with center spiral ring for wall calendars

All files stored locally in IndexedDB — nothing leaves the device.

## Goals
- Single HTML file deployment (like simple-pdf-flip-book)
- CSS 3D Transform page flips (no Three.js, no Canvas 3D)
- pdf.js for PDF rendering (ESM via CDN)
- IndexedDB for offline file storage + reading progress
- Drag-drop PDF loading, file picker support
- Keyboard/touch/mouse navigation
- Responsive down to mobile widths
- Theme support (light/dark/sepia)

## Non-Goals
- EPUB support (v1)
- Annotations/highlights (v1)
- TTS/read-aloud (v1)
- Cloud sync
- Server component

## Constraints
- Single HTML file ≤ 500KB gzipped
- No build step required (ESM via importmap/CDN)
- Works offline after first load (Service Worker optional)
- pdf.js 4.x via unpkg/esm.sh
- idb (IndexedDB wrapper) via esm.sh

## Approaches Considered

| Approach | Trade-offs | Decision |
|----------|------------|----------|
| Single HTML (chosen) | +Zero deploy, +offline, +shareable | ✅ Matches simple-pdf-flip-book |
| Modular + build | +Maintainable, +TypeScript | ❌ Adds complexity |
| Three.js flips | +Spiral ring easier | ❌ Heavy, overkill for page flip |
| Canvas 2D flips | +Full control | ❌ Complex shadows/curl math |

## Architecture

```
HAN-Pustaka.html
├── CSS (embedded <style>)
│   ├── CSS Variables (themes, dimensions)
│   ├── 3D Flip animations (book/comic/calendar)
│   ├── Responsive layout (grid/flex)
│   └── Spiral ring (calendar mode)
├── HTML Structure
│   ├── Top bar (mode switch, file load, theme, fullscreen)
│   ├── Stage (perspective container)
│   │   ├── Book/Comic: #deck with .leaf elements
│   │   └── Calendar: #calendar with .month-sheet + .spiral-ring
│   ├── Bottom bar (navigation, page indicator, zoom)
│   └── Panels (shelf/library, settings)
├── JS (embedded <script type=module>)
│   ├── State machine (mode, current page, zoom, theme)
│   ├── PDF.js loader (pdfjs-dist ESM)
│   ├── IndexedDB (idb wrapper) - shelf, progress, settings
│   ├── Flip controller (CSS 3D transform orchestration)
│   ├── Input handlers (keyboard, touch, wheel, drag)
│   └── Render pipeline (PDF page → canvas → leaf texture)
```

## Three Flip Modes

### 1. Book Mode (RTL)
- Two-page spread, perspective ~2800px
- Right page turns left (rotateY -180deg)
- Left page turns right (rotateY 180deg)
- Page stack depth on left/right edges
- Gutter shadow in center

### 2. Comic Mode (LTR)
- Same as Book but mirrored
- Left page turns right (rotateY 180deg)
- Right page turns left (rotateY -180deg)
- Stack depth mirrored

### 3. Calendar Mode (Bottom-to-Top)
- Single sheet at a time (month view)
- Flip originates from bottom edge (rotateX 180deg)
- **Spiral ring** at center top of sheet:
  - SVG ring with 12 holes (months)
  - Current month highlighted
  - Rotates with sheet during flip
- Shadow cast upward during flip
- Next month pre-rendered on back face

## Data Model (IndexedDB)

```js
// DB: bookflip-db v1
stores: {
  files: { keyPath: 'id', autoIncrement: true }
    // { id, name, data: Uint8Array, type: 'pdf'|'image', cover: blob, pages: number, added: timestamp }
  progress: { keyPath: 'fileId' }
    // { fileId, mode, currentPage, zoom, theme, updated: timestamp }
  settings: { keyPath: 'key' }
    // { key: 'theme', value: 'auto' }, { key: 'mode', value: 'book' }
}
```

## PDF Rendering Pipeline

```
PDF File → pdfjsLib.getDocument() → PDFDocumentProxy
  → for each page: page.render({ canvasContext, viewport })
  → canvas.toDataURL() → set as leaf background-image
  → (lazy: render on-demand, cache in memory)
```

## Interaction Model

| Input | Book/Comic | Calendar |
|-------|------------|----------|
| Click right edge | Next page | — |
| Click left edge | Prev page | — |
| Click bottom | — | Next month |
| Drag from edge | Page curl preview | Sheet lift preview |
| Wheel | Zoom (Ctrl) / Page | Month |
| Arrow keys | ←/→ pages | ↑/↓ months |
| Space | Next | Next |
| Touch swipe | Horizontal drag | Vertical drag |

## Visual Design (CSS Variables)

```css
:root {
  --ink: #241f1b; --muted: #756c63;
  --paper: #fffdf8; --paper-2: #f6f1e6;
  --stage: #aa9f91; --stage-dark: #776d63;
  --accent: #9a493d; --accent-soft: rgba(154,73,61,.14);
  --shadow: rgba(39,29,21,.28);
  --page-w: 520px; --page-h: 740px;
  --flip-ms: 620ms; --ease: cubic-bezier(.2,.78,.2,1);
  --spiral-ring-w: 60px; --spiral-hole-r: 4px;
  --spiral-metal: #c9b896; --spiral-shadow: rgba(0,0,0,.35);
}
[data-theme="dark"] { /* midnight vars */ }
[data-theme="sepia"] { /* sepia vars */ }
```

## Spiral Ring Implementation (Calendar)

SVG embedded in each `.month-sheet`:
```html
<svg class="spiral-ring" viewBox="0 0 60 20">
  <!-- Wire spiral path -->
  <path class="spiral-wire" d="M5,10 Q30,0 55,10" stroke="var(--spiral-metal)" fill="none" stroke-width="3"/>
  <!-- 12 holes -->
  <g class="spiral-holes">
    <circle cx="5" cy="10" r="4" />
    <circle cx="9.5" cy="8" r="4" />
    ... 10 more ...
    <circle cx="55" cy="10" r="4" />
  </g>
  <!-- Current month indicator -->
  <circle class="current-month" cx="..." cy="..." r="5" fill="var(--accent)" />
</svg>
```

Positioned at top-center of sheet, rotates with `.face` during flip.

## File Structure (Single HTML)

```html
<!doctype html>
<html lang="en" data-theme="auto">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>HAN-Pustaka</title>
  <importmap>{ "imports": { "pdfjs-dist": "https://unpkg.com/pdfjs-dist@4.x/build/pdf.mjs", "idb": "https://esm.sh/idb@8" } }</importmap>
  <style>/* all CSS */</style>
</head>
<body>
  <!-- HTML structure -->
  <script type="module">/* all JS */</script>
</body>
</html>
```

## Implementation Order

1. **HTML skeleton + CSS variables + base layout**
2. **IndexedDB wrapper + file loading (drag-drop, picker)**
3. **PDF.js integration + page rendering to canvas**
4. **Book mode flip (RTL) - CSS 3D + JS controller**
5. **Comic mode flip (LTR) - mirrored Book**
6. **Calendar mode flip (Bottom-to-Top) + Spiral Ring SVG**
7. **Mode switcher + persistence**
8. **Navigation (keyboard, touch, wheel, UI controls)**
9. **Shelf/Library UI + progress restore**
10. **Themes + Settings panel**
11. **Polish: shadows, sheen, transitions, mobile responsive**

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| pdf.js ESM + worker loading | Use `GlobalWorkerOptions.workerSrc` to CDN worker |
| Large PDFs memory | Render pages on-demand, evict LRU, max 3 pages cached |
| iOS Safari 3D transform bugs | Test `backface-visibility`, `transform-style: preserve-3d` |
| Spiral ring alignment | Use SVG with fixed viewBox, position absolute top-center |
| Single file size | Minify CSS/JS inline, use importmap for deps |

## Acceptance Criteria

- [ ] Drag PDF → opens in Book mode (RTL flip)
- [ ] Mode switch: Book ↔ Comic ↔ Calendar
- [ ] Calendar shows spiral ring, flips bottom-to-top
- [ ] Files persist in IndexedDB, reopen to last page
- [ ] Works offline after first load
- [ ] Mobile: touch drag to flip, pinch zoom
- [ ] Keyboard: arrows, space, Ctrl+wheel zoom
- [ ] Themes: light, dark, sepia, auto
- [ ] Single HTML file < 500KB gzipped