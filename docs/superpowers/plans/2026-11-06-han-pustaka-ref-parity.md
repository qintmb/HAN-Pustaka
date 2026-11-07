# HAN-Pustaka Ref Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.
> Steps use checkbox (`- [ ]`) syntax.

Design: `docs/superpowers/specs/2026-11-06-HAN-Pustaka-ref-parity-design.md`

**Goal:** shelf bergaya ref dengan data IndexedDB, flipbook benar-benar render.

**Architecture:** 3 file statis (`index.html`, `app.js`, `styles.css`) + aset
vendor lokal. Tanpa build step. `app.js` satu modul ES, pola `HistoryDB` /
`PDFThumb` yang sudah ada dipertahankan.

**Tech:** jQuery 1.8.3, flipbook v3.8 (`$.fn.flipBook`), pdf.js 2.6.2 (`pdfjsLib`).

**Verifikasi tiap task:** server `python3 -m http.server 8099` + Playwright headless
(chromium-1243, executable di
`~/Library/Caches/ms-playwright/chromium-1243/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`).

---

## File Structure

| File | Tanggung jawab |
|---|---|
| `index.html` | Struktur: navbar, shelf, kartu detail, pagination, footer, host flipbook |
| `app.js` | DB, thumb, shelf render, detail, reader (flipbook), pagination |
| `styles.css` | Semua style app (di atas `flipbook.style.css`) |
| `vendor/images/overlay_lightbox.png` | Aset lightbox yang belum disalin |

---

## Task 1: Aset hilang + hapus duplikasi CSS

**Deliverable:** 404 lightbox hilang; CSS punya satu blok per komponen.

- [ ] Copy `overlay_lightbox.png` dari ref ke `vendor/images/`.
- [ ] Hapus blok `.flipbook-lightbox` … `.flipbook-loading img` yang kedua
      (duplikat persis) dari `styles.css`.
- [ ] Verifikasi: `diff <(sed -n '/flipbook-lightbox/,/loading img/p' styles.css | sort | uniq -d)` kosong.

## Task 2: index.html — struktur ref

**Deliverable:** halaman tampil dengan navbar, area shelf, kartu detail, pagination, footer.

- [ ] Ganti isi `<body>`: navbar (brand generik + form search), `#shelfArea`,
      `#detailCard` (hidden), `#pagination`, `#footer`, `#bookHost` (hidden), toast.
- [ ] Pertahankan urutan `<script>` vendor yang sudah ada.

## Task 3: app.js — DB + thumbnail + shelf

**Deliverable:** drop PDF → row shelf muncul → refresh tetap ada.

- [ ] `HistoryDB`: satu store `books`; `listBooks`, `getBook`, `saveBook`, `removeBook`.
- [ ] `PDFThumb.renderFirstPage(blob)`.
- [ ] `Shelf.render()` — 5 cover/baris, siklus 3 gambar shelf, klik → `openDetails`.

## Task 4: app.js — kartu detail + pagination

**Deliverable:** klik cover → kartu detail; >15 buku → pagination muncul.

- [ ] `Details.open(book)` / `close()`; tombol Baca + Unduh.
- [ ] `Pagination` 15 buku/halaman.

## Task 5: app.js — reader flipbook + persistensi

**Deliverable:** Baca PDF → flipbook render → flip → tutup → buka lagi di halaman tersimpan.

- [ ] `Reader.open(book)`: `flipBook({ lightBox:true, lightBoxOpened:true, pdfUrl:blob, startPage })`.
- [ ] `$(inst).on('pagechange')` + `inst.model.on('change')` → debounce simpan.
- [ ] `Reader.close()`: `inst.lightbox.closeLightbox()` → teardown → revoke blob.

## Task 6: styles.css — navbar, kartu, pagination, footer

**Deliverable:** tampilan setara ref, responsif sampai lebar mobile.

- [ ] Style komponen baru; tombol `min-height: 44px`.
- [ ] Hapus aturan `.drop-zone` bila drop zone dilebur ke navbar.

## Task 7: Verifikasi end-to-end headless

**Deliverable:** bukti output untuk setiap acceptance criterion.

- [ ] Drop `test.pdf` → shelf berisi 1 buku.
- [ ] Reload → buku masih ada (IndexedDB).
- [ ] Klik cover → kartu detail terlihat.
- [ ] Klik Baca PDF → `canvas` di dalam `.book` ≥ 1, `currentPageValue` = "1".
- [ ] `nextPage()` ×2 → `pagechange` menyimpan halaman.
- [ ] Tutup → buka lagi → `currentPageValue` = halaman tersimpan.
- [ ] Hapus buku → hilang dari shelf + dari IndexedDB.
