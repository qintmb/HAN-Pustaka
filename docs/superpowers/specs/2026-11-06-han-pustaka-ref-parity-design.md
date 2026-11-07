# HAN-Pustaka — Ref UI Parity + Working Flipbook (Design)

Date: 2026-11-06
Status: approved

## Intent & Why

`plan.md` mendefinisikan clone offline-first dari `kubil-ismail/Pdf-Flipbook`.
Step 1, 2, 4, 5 sudah jalan sebagian; step 3 (app.js flipbook) **tidak pernah
render halaman** dan persistensi progress mati total. Tujuan: shelf yang mirip
ref, tapi isinya dari IndexedDB, dan flipbook benar-benar tampil.

## Goals

- Struktur UI sama dengan ref: navbar, baris shelf dengan gambar shelf, kartu
  detail buku, pagination, footer 3 kolom + social row.
- Drop / pilih PDF → tersimpan di IndexedDB → muncul di shelf → refresh tetap ada.
- Klik cover → kartu detail → tombol `Baca PDF` → lightbox flipbook berfungsi
  (WebGL page curl, sound, thumbnail, zoom).
- Progress (halaman terakhir) dan zoom tersimpan per buku, restore saat dibuka.
- Semua aset lokal, tanpa CDN.

## Non-Goals

- Annotations (docs/spec.md menyebut non-goal v1).
- Book/Comic/Calendar mode + spiral ring dari docs/spec.md (itu spec lama yang
  bertentangan dengan plan.md; plugin ref hanya punya mode webgl/3d/2d/swipe).
- Branding KPK, asset `book2/*` sampel.
- Bootstrap CDN — CSS ditulis sendiri.

## Constraints

Terkonfirmasi dari source vendor (bukan asumsi):

- `lightBox: true` **tidak** auto-start. Butuh `lightBoxOpened: true`.
  Tanpa itu: preloader tampil, `canvas: 0`, selamanya.
- Tanpa `lightBoxOpened`, plugin memasang handler klik di elemen host; lightbox
  milik app sendiri menutupinya → klik tak pernah sampai.
- Opsi `onReady` / `onPageChange` / `onZoomStart` / `onZoomEnd` **tidak ada** di
  `$.fn.flipBook.options` v3.8. Terverifikasi di spike: callback tidak dipanggil.
- API riil: jQuery event `pagechange` (`e.page`, string) di elemen plugin, dan
  objek model yang diekspos sebagai `inst.model` dengan `model.on("change", ...)`
  serta `model.zoom`.
- `pdfUrl` menerima blob URL (terverifikasi).
- Tidak ada `destroy()`. Teardown = hapus elemen `.flipbook-overlay`,
  `.flipbook-preloader`, kosongkan host, revoke blob URL.
- `overlay_lightbox.png` adalah font/asset yang direquest saat lightbox dibuka
  (404 pada kode sekarang) → harus disalin dari ref.
- pdf.js v2.6.2 global bernama `pdfjsLib`; worker versi sama.

## Approaches Considered

1. **`lightBox: true` + lightbox milik plugin, host = tombol tersembunyi** —
   paling dekat dengan ref, tapi overlay app bertabrakan dengan overlay plugin,
   dan menutup butuh membalik alur klik.
2. **`lightBox: false` (flipbook inline di dalam container lightbox app)** —
   spike berhasil render, tapi kehilangan menu tombol close/expand/fullscreen
   bawaan plugin yang membuat UI ref terasa sama, dan `pagechange` tetap perlu
   di-handle manual.
3. **`lightBox: true, lightBoxOpened: true`** — ✅ dipilih. Plugin mengelola
   overlay/toolbar/menu sendiri seperti ref, `closeLightbox()` tersedia via
   `btnClose` bawaan, dan `pagechange` terpicu normal. Terverifikasi render,
   navigasi 2x, close, reopen di halaman tersimpan.

## Design

**File:** `index.html`, `app.js`, `styles.css`, + `vendor/images/overlay_lightbox.png`.

`index.html`: `<script>` vendor tetap (urutan sudah benar). Tambah navbar,
container shelf, kartu detail (tersembunyi), pagination, footer. Lightbox app
yang sekarang dipakai sebagai *container* diganti: karena plugin membuat
overlay-nya sendiri dari `<body>`, app hanya perlu host `#bookHost` yang
disembunyikan, plus overlay status kita sendiri dihindari.

`app.js` (satu file, pola yang ada dipertahankan):

- `HistoryDB` — store `books` (keyPath `id`) + `thumbs`. `listBooks()` diurutkan
  `addedAt` desc, `updateProgress(id, lastPage, zoom)`, `removeBook(id)`.
  Hapus store `thumbs` terpisah (properti `thumbDataUrl` sudah ada di record —
  satu store, satu tulisan).
- `PDFThumb.renderFirstPage(blob)` → dataURL (terverifikasi: 183x237 JPEG).
- `Shelf` — render baris: maks 5 cover/baris, siklus `shelf_wood|glass|metal`,
  klik cover → `openDetails(book)`.
- `Details` — isi kartu, tombol `Baca PDF` → `openReader(book)`,
  tombol `Unduh PDF` → anchor blob.
- `Reader` — `$('#bookHost').flipBook({ lightBox:true, lightBoxOpened:true,
  pdfUrl, startPage, ... })`; bind `$(inst).on('pagechange', e => save(e.page))`;
  bind `inst.model.on('change')` untuk zoom; simpan debounce 400ms.
  `closeReader()` memanggil `inst.lightbox.closeLightbox()` lalu teardown.
- `Pagination` — `PER_PAGE = 15` buku (3 baris × 5), tombol prev/next; disembunyikan
  bila hanya 1 halaman.

`styles.css`: hapus blok `.flipbook-lightbox`/`.toast` yang terduplikasi;
tambah style navbar, kartu, pagination, footer (mengikuti `footer.css` ref tapi
palet netral).

## What's Left to the Builder

Nilai palet netral, teks footer, dan urutan ikon social.
