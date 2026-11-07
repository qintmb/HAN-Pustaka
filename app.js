// HAN-Pustaka — offline-first PDF flipbook.
// Semua library di-load sebagai script global (jQuery, flipbook v3.8, pdf.js 2.6.2).
import { openDB, get, put, del, getAll } from './idb.min.js';
// ============================================
// Konstanta
// ============================================
const DB_NAME = 'bookflip-db';
const DB_VER = 2;
const STORE = 'books';
const BOOKS_PER_SHELF = 7;
const SHELVES_PER_PAGE = 3;
const BOOKS_PER_PAGE = BOOKS_PER_SHELF * SHELVES_PER_PAGE;
const SAVE_DEBOUNCE_MS = 400;
const SHELF_IMAGES = [
  'vendor/images/shelf_wood.png',
  'vendor/images/shelf_glass.png',
  'vendor/images/shelf_metal.png'
];
const FLIPBOOK_ASSETS = {
  preloader: 'vendor/images/preloader.jpg',
  overlay: 'vendor/images/overlay.png',
  flipMp3: 'vendor/mp3/turnPage.mp3',
  spinner: 'vendor/images/spinner.gif'
};
// ============================================
// State
// ============================================
let db = null;
let allBooks = [];
let filteredBooks = [];
let currentPage = 0;
let activeBook = null;
let detailBlobUrl = null;
let reader = null; // { inst, blobUrl, onPageChange, saveTimer }
// ============================================
// DOM
// ============================================
const qs = (sel) => document.querySelector(sel);
const fileInput = qs('#fileInput');
const browseBtn = qs('#browseBtn');
const uploadDropZone = qs('#uploadDropZone');
const shelfArea = qs('#shelfArea');
const shelfTitle = qs('#shelfTitle');
const paginationEl = qs('#pagination');
const detailCard = qs('#detailCard');
const detailCover = qs('#detailCover');
const detailTitle = qs('#detailTitle');
const detailSize = qs('#detailSize');
const detailDate = qs('#detailDate');
const detailPages = qs('#detailPages');
const detailDescription = qs('#detailDescription');
const detailRead = qs('#detailRead');
const detailDelete = qs('#detailDelete');
const toastContainer = qs('#toastContainer');
const searchForm = qs('#searchForm');
const searchInput = qs('#searchInput');
const bookHost = document.getElementById('bookHost');
// Sidebar
const sidebar = qs('#sidebar');
// ============================================
// Util
// ============================================
function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  toastContainer.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}
function sha256(arrayBuffer) {
  return crypto.subtle.digest('SHA-256', arrayBuffer).then((hash) => {
    return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
  });
}
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
function formatDate(ts) {
  return new Date(ts).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}
// ============================================
// Penyimpanan
// ============================================
const HistoryDB = {
  async init() {
    db = await openDB(DB_NAME, DB_VER, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE, { keyPath: 'id' });
        }
      }
    });
    return db;
  },
  async listBooks() {
    const books = await getAll(db, STORE);
    return books.sort((a, b) => a.sortOrder != null && b.sortOrder != null
      ? a.sortOrder - b.sortOrder
      : b.addedAt - a.addedAt);
  },
  getBook(id) {
    return get(db, STORE, id);
  },
  saveBook(record) {
    return put(db, STORE, record);
  },
  deleteBook(id) {
    return del(db, STORE, id);
  }
};
// ============================================
// Render PDF: thumbnail + jumlah halaman
// ============================================
const PDFThumb = {
  async render(blob) {
    const data = await blob.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 0.3 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const numPages = pdf.numPages;
    pdf.destroy();
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.7), numPages };
  }
};
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/js/pdf.worker.min.js';
}
// ============================================
// Rak buku
// ============================================
function coverThumbUrl(book) {
  return book.thumbDataUrl || 'vendor/images/Transparent.png';
}
function buildCover(book) {
  const thumb = document.createElement('div');
  thumb.className = 'thumb book-1';
  thumb.dataset.id = book.id;
  thumb.draggable = true;
  thumb.setAttribute('role', 'listitem');
  const img = document.createElement('img');
  img.alt = `Cover ${book.name}`;
  img.src = coverThumbUrl(book);
  thumb.appendChild(img);
  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'cover-open';
  openBtn.setAttribute('aria-label', `Buka detail ${book.name}`);
  openBtn.addEventListener('click', () => Details.open(book));
  thumb.appendChild(openBtn);
  thumb.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', book.id);
    e.dataTransfer.effectAllowed = 'move';
  });
  thumb.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
  thumb.addEventListener('drop', async (e) => {
    e.preventDefault();
    const from = allBooks.findIndex((item) => item.id === e.dataTransfer.getData('text/plain'));
    const to = allBooks.findIndex((item) => item.id === book.id);
    if (from < 0 || to < 0 || from === to) return;
    const [moved] = allBooks.splice(from, 1);
    allBooks.splice(to, 0, moved);
    allBooks.forEach((item, index) => { item.sortOrder = index; });
    await Promise.all(allBooks.map((item) => HistoryDB.saveBook(item)));
    applyFilter();
  });
  return thumb;
}
function renderShelfPage() {
  shelfArea.innerHTML = '';
  if (filteredBooks.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = allBooks.length
      ? 'Tidak ada buku yang cocok dengan pencarian.'
      : 'Klik + atau seret PDF ke header untuk mulai.';
    shelfArea.appendChild(empty);
    paginationEl.hidden = true;
    return;
  }
  const pageBooks = filteredBooks.slice(currentPage * BOOKS_PER_PAGE, (currentPage + 1) * BOOKS_PER_PAGE);
  for (let i = 0; i < pageBooks.length; i += BOOKS_PER_SHELF) {
    const shelfIdx = i / BOOKS_PER_SHELF;
    const shelf = document.createElement('div');
    shelf.className = 'bookshelf';
    const covers = document.createElement('div');
    covers.className = 'covers';
    covers.setAttribute('role', 'list');
    pageBooks.slice(i, i + BOOKS_PER_SHELF).forEach((book) => covers.appendChild(buildCover(book)));
    const shelfImg = document.createElement('img');
    shelfImg.className = 'shelf-img';
    shelfImg.src = SHELF_IMAGES[shelfIdx % SHELF_IMAGES.length];
    shelfImg.alt = '';
    shelf.append(covers, shelfImg);
    shelfArea.appendChild(shelf);
  }
  renderPagination();
}
function renderPagination() {
  const pageCount = Math.ceil(filteredBooks.length / BOOKS_PER_PAGE);
  if (pageCount <= 1) {
    paginationEl.hidden = true;
    return;
  }
  paginationEl.hidden = false;
  paginationEl.innerHTML = '';
  const makeItem = (label, targetPage, { disabled = false, active = false, ariaLabel } = {}) => {
    const li = document.createElement('button');
    li.type = 'button';
    li.className = 'page-link' + (active ? ' active' : '');
    li.textContent = label;
    if (ariaLabel) li.setAttribute('aria-label', ariaLabel);
    if (active) li.setAttribute('aria-current', 'page');
    li.disabled = disabled;
    li.addEventListener('click', () => goToPage(targetPage));
    return li;
  };
  paginationEl.appendChild(
    makeItem('«', currentPage - 1, { disabled: currentPage === 0, ariaLabel: 'Halaman sebelumnya' })
  );
  for (let p = 0; p < pageCount; p++) {
    paginationEl.appendChild(makeItem(String(p + 1), p, { active: p === currentPage }));
  }
  paginationEl.appendChild(
    makeItem('»', currentPage + 1, {
      disabled: currentPage === pageCount - 1,
      ariaLabel: 'Halaman berikutnya'
    })
  );
}
function goToPage(page) {
  const pageCount = Math.ceil(filteredBooks.length / BOOKS_PER_PAGE);
  if (page < 0 || page >= pageCount || page === currentPage) return;
  currentPage = page;
  renderShelfPage();
  shelfTitle.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function refreshShelf() {
  allBooks = await HistoryDB.listBooks();
  applyFilter();
}
function applyFilter() {
  const query = searchInput.value.trim().toLowerCase();
  filteredBooks = query ? allBooks.filter((b) => b.name.toLowerCase().includes(query)) : allBooks.slice();
  currentPage = Math.min(currentPage, Math.max(0, Math.ceil(filteredBooks.length / BOOKS_PER_PAGE) - 1));
  renderShelfPage();
}
async function removeBook(book) {
  if (!confirm(`Hapus "${book.name}" dari rak? File akan hilang dari perangkat.`)) return;
  await HistoryDB.deleteBook(book.id);
  if (activeBook && activeBook.id === book.id) Details.close();
  showToast('Buku dihapus', 'success');
  await refreshShelf();
}
// ============================================
// Kartu detail
// ============================================
const Details = {
  open(book) {
    if (activeBook?.id === book.id) {
      this.close();
      return;
    }
    if (reader) Reader.close();
    activeBook = book;
    if (detailBlobUrl) URL.revokeObjectURL(detailBlobUrl);
    detailBlobUrl = URL.createObjectURL(book.blob);
    detailCover.src = coverThumbUrl(book);
    detailCover.alt = `Cover ${book.name}`;
    detailTitle.textContent = book.name;
    detailSize.textContent = formatSize(book.size);
    detailDate.textContent = formatDate(book.addedAt);
    detailPages.textContent = book.numPages ? `${book.numPages} halaman` : '';
    qs(`input[name="pdfCategory"][value="${book.category === 'calendar' ? 'calendar' : 'book'}"]`).checked = true;
    detailDescription.textContent = book.lastPage > 0
      ? `Terakhir dibaca sampai halaman ${book.lastPage}.`
      : 'Belum pernah dibuka.';
    detailCard.hidden = false;
    sidebar.classList.remove('is-hidden', 'collapsed');
  },
  close() {
    sidebar.classList.add('is-hidden');
    activeBook = null;
    if (detailBlobUrl) {
      URL.revokeObjectURL(detailBlobUrl);
      detailBlobUrl = null;
    }
    window.setTimeout(() => {
      if (sidebar.classList.contains('is-hidden')) detailCard.hidden = true;
    }, 220);
  }
};
// ============================================
// Flipbook reader
// ============================================
const Reader = {
  open(book) {
    if (reader) Reader.close();
    const category = book.category === 'calendar' ? 'calendar' : 'book';
    book.category = category;
    if (category === 'book') {
      return Reader.openBook(book);
    }
    return Reader.openCalendar(book, category);
  },
  async openCalendar(book, mode = 'calendar') {
    const overlay = document.createElement('section');
    overlay.className = 'calendar-reader';
    overlay.setAttribute('aria-label', `${mode === 'book' ? 'Buku' : 'Kalender'} ${book.name}`);
    overlay.innerHTML = '<iframe class="calendar-frame" title="Tampilan PDF" allow="fullscreen" allowfullscreen></iframe>';
    document.body.appendChild(overlay);
    document.documentElement.classList.add('flipbook-overflow-hidden');
    const frame = overlay.querySelector('.calendar-frame');
    const state = { calendar: true, embeddedCalendar: true, book, overlay, frame, saveTimer: null };
    reader = state;
    state.onMessage = (event) => {
      if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
      if (event.data?.type === 'han-pustaka-calendar-page') {
        book.lastPage = event.data.page;
        book.numPages = event.data.numPages;
        Reader.scheduleSave(book);
      } else if (event.data?.type === 'han-pustaka-calendar-close') Reader.close();
      else if (event.data?.type === 'han-pustaka-calendar-error') showToast(`Kalender gagal dibuka: ${event.data.message}`, 'error');
    };
    window.addEventListener('message', state.onMessage);
    frame.addEventListener('load', async () => {
      if (reader !== state) return;
      const data = await book.blob.arrayBuffer();
      if (reader === state) frame.contentWindow.postMessage({ type: 'han-pustaka-open-calendar', mode, name: book.name, lastPage: book.lastPage || 1, data }, location.origin, [data]);
    }, { once: true });
    frame.src = `calendar.html?embed=1&mode=${mode}`;
  },
  async openCalendarThree(book) {
    const blobUrl = URL.createObjectURL(book.blob);
    const overlay = document.createElement('section');
    overlay.className = 'calendar-reader';
    overlay.setAttribute('aria-label', `Kalender ${book.name}`);
    overlay.innerHTML = '<header class="calendar-toolbar"><button type="button" class="calendar-prev" aria-label="Halaman sebelumnya"><i class="fa fa-chevron-left" aria-hidden="true"></i></button><span class="calendar-page-count"></span><button type="button" class="calendar-next" aria-label="Halaman berikutnya"><i class="fa fa-chevron-right" aria-hidden="true"></i></button><button type="button" class="calendar-autoplay" aria-label="Putar otomatis" aria-pressed="false"><i class="fa fa-play" aria-hidden="true"></i></button><button type="button" class="calendar-fullscreen" aria-label="Layar penuh"><i class="fa fa-expand" aria-hidden="true"></i></button><button type="button" class="calendar-close" aria-label="Tutup PDF"><i class="fa fa-times" aria-hidden="true"></i></button></header><div class="calendar-stage"></div><div class="calendar-zoom-controls"><button type="button" class="calendar-zoom-out" aria-label="Perkecil" title="Perkecil">−</button><button type="button" class="calendar-zoom-in" aria-label="Perbesar" title="Perbesar">+</button></div>';
    document.body.appendChild(overlay);
    document.documentElement.classList.add('flipbook-overflow-hidden');
    const stage = overlay.querySelector('.calendar-stage');
    const pdf = await pdfjsLib.getDocument({ url: blobUrl }).promise;
    const THREE = window.THREE;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = false;
    stage.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf1eee7);
    const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, .1, 100);
    camera.position.set(0, 0, 20);
    const ambient = new THREE.AmbientLight(0xffffff, .28);
    scene.add(ambient);
    const keyLight = new THREE.DirectionalLight(0xfff8e9, .32);
    keyLight.position.set(-4, 7, 7);
    scene.add(keyLight);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), new THREE.MeshBasicMaterial({ color: 0xf1eee7 }));
    wall.position.z = -1.2;
    scene.add(wall);
    const group = new THREE.Group();
    scene.add(group);
    const firstPage = await pdf.getPage(1);
    const firstViewport = firstPage.getViewport({ scale: 1 });
    const bindingWidth = 2.65 * firstViewport.width / firstViewport.height;
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = shadowCanvas.height = 128;
    const shadowContext = shadowCanvas.getContext('2d');
    const shadowGradient = shadowContext.createRadialGradient(64, 64, 24, 64, 64, 64);
    shadowGradient.addColorStop(0, 'rgba(25,20,15,.12)');
    shadowGradient.addColorStop(1, 'rgba(25,20,15,0)');
    shadowContext.fillStyle = shadowGradient;
    shadowContext.fillRect(0, 0, 128, 128);
    const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
    const calendarShadow = new THREE.Mesh(new THREE.PlaneGeometry(bindingWidth + .24, 5.35), new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, opacity: .55, depthWrite: false }));
    calendarShadow.position.set(.035, -.035, -.12);
    scene.add(calendarShadow);
    const material = (canvas, side = THREE.FrontSide) => {
      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      return new THREE.MeshBasicMaterial({ map: texture, side });
    };
    let width = 0, height = 0;
    const renderPage = async (n) => {
      if (n > pdf.numPages) return null;
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(1400 / base.width, 900 / base.height, 1.5);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      return canvas;
    };
    const makePage = (canvas, y) => {
      if (!canvas) return null;
      const w = canvas.width / Math.max(canvas.height, 1) * 2.65;
      const geometry = new THREE.PlaneGeometry(w, 2.65, 20, 24);
      const mesh = new THREE.Mesh(geometry, material(canvas));
      mesh.position.set(0, y, 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    };
    const disposeMesh = (mesh) => {
      if (!mesh) return;
      group.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.map?.dispose();
      mesh.material.dispose();
    };
    const sizeScene = () => {
      const rect = stage.getBoundingClientRect();
      renderer.setSize(rect.width, rect.height);
      const aspect = rect.width / Math.max(rect.height, 1);
      const viewHeight = 5.7 / (reader?.calendarZoom || 1);
      camera.left = -viewHeight * aspect / 2;
      camera.right = viewHeight * aspect / 2;
      camera.top = viewHeight / 2;
      camera.bottom = -viewHeight / 2;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    let topMesh = null, bottomMesh = null, flipGroup = null, raf = 0;
    const disposeFlip = () => {
      if (!flipGroup) return;
      group.remove(flipGroup);
      flipGroup.children.forEach((mesh) => { mesh.geometry.dispose(); mesh.material.map?.dispose(); mesh.material.dispose(); });
      flipGroup = null;
    };
    window.addEventListener('resize', sizeScene);
    reader = { calendar: true, blobUrl, pdf, overlay, renderer, scene, camera, group, calendarShadow, saveTimer: null, current: 1, calendarZoom: 1, autoplayTimer: null, resize: sizeScene };
    const prevButton = overlay.querySelector('.calendar-prev');
    const nextButton = overlay.querySelector('.calendar-next');
    const updateNavigation = (page) => {
      prevButton.disabled = page <= 1;
      nextButton.disabled = page >= pdf.numPages;
    };
    updateNavigation(1);
    const showPage = async (n, animate = true) => {
      const state = reader;
      if (!state?.calendar || state.overlay !== overlay || n < 1 || n > pdf.numPages) return;
      if (state.turning) { state.queuedPage = n; return; }
      n = Math.max(1, Math.min(n, pdf.numPages));
      if (n === state.current && (n === 1 ? !!topMesh && !bottomMesh : !!topMesh && !!bottomMesh)) return;
      state.turning = true;
      const unlockTimer = setTimeout(() => {
        if (!state.turning) return;
        state.turning = false;
        if (state.queuedPage != null) {
          const queued = state.queuedPage;
          state.queuedPage = null;
          showPage(queued, true);
        }
      }, 1400);
      const finishTurn = () => {
        clearTimeout(unlockTimer);
        state.turning = false;
        if (state.queuedPage != null) {
          const queued = state.queuedPage;
          state.queuedPage = null;
          showPage(queued, true);
        }
      };
      try {
      if (animate && n !== state.current) {
        const flipSound = new Audio(FLIPBOOK_ASSETS.flipMp3);
        flipSound.volume = .65;
        flipSound.play().catch((error) => console.warn('Suara flip tidak tersedia', error));
      }
      const [topCanvas, bottomCanvas] = await Promise.all([renderPage(n), n === 1 ? Promise.resolve(null) : renderPage(n + 1)]);
      if (animate && topMesh && n !== state.current) {
        const turn = new THREE.Group();
        turn.position.set(0, 0, .22);
        const h = 2.65;
        const forward = n > state.current;
        const flipCover = forward && !bottomMesh;
        const flipTopDown = !forward;
        const sheetCanvas = flipCover ? await renderPage(state.current) : await renderPage(forward ? state.current + 1 : state.current);
        const w = sheetCanvas.width / sheetCanvas.height * h;
        const geom = new THREE.PlaneGeometry(w, h, 24, 32);
        geom.translate(0, flipCover || flipTopDown ? h / 2 : -h / 2, 0);
        const originalPositions = geom.attributes.position.array.slice();
        const backGeometry = geom.clone();
        const front = new THREE.Mesh(geom, material(sheetCanvas));
        const backCanvas = flipCover ? await renderPage(2) : forward ? await renderPage(state.current + 2) : await renderPage(Math.max(1, state.current - 1));
        const back = new THREE.Mesh(backGeometry, material(backCanvas, THREE.BackSide));
        back.position.z = -.005;
        front.castShadow = true;
        back.castShadow = true;
        front.receiveShadow = true;
        back.receiveShadow = true;
        turn.add(front, back);
        group.remove(flipCover || flipTopDown ? topMesh : bottomMesh);
        group.add(turn);
        flipGroup = turn;
        const start = performance.now();
        const animateFlip = (now) => {
          try {
          const t = Math.min((now - start) / 850, 1);
          const eased = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
          const bend = Math.sin(eased * Math.PI);
          [geom, backGeometry].forEach((geometry) => {
            const position = geometry.attributes.position;
            for (let i = 0; i < position.count; i++) {
              const offset = i * 3;
              const x = originalPositions[offset];
              const y = originalPositions[offset + 1];
              const distance = flipCover || flipTopDown ? y / h : -y / h;
              const u = Math.max(0, Math.min(distance, 1));
              const angle = (flipCover || flipTopDown ? 1 : -1) * eased * Math.PI * u;
              position.array[offset + 1] = y * Math.cos(angle);
              position.array[offset + 2] = y * Math.sin(angle) + bend * .38 * Math.sin(Math.PI * u) * (1 - Math.abs(x) / (w / 2));
            }
            position.needsUpdate = true;
            geometry.computeVertexNormals();
          });
          renderer.render(scene, camera);
          if (t < 1) raf = requestAnimationFrame(animateFlip);
          else {
            disposeFlip();
            backGeometry.dispose();
            disposeMesh(topMesh); disposeMesh(bottomMesh);
            topMesh = makePage(topCanvas, 1.325);
            bottomMesh = makePage(bottomCanvas, -1.325);
            if (topMesh) group.add(topMesh);
            if (bottomMesh) group.add(bottomMesh);
            renderer.render(scene, camera);
            finishTurn();
          }
          } catch (error) {
            console.error('Animasi flip kalender gagal', error);
            disposeFlip();
            disposeMesh(topMesh); disposeMesh(bottomMesh);
            topMesh = makePage(topCanvas, 1.325);
            bottomMesh = makePage(bottomCanvas, -1.325);
            if (topMesh) group.add(topMesh);
            if (bottomMesh) group.add(bottomMesh);
            renderer.render(scene, camera);
            finishTurn();
          }
        };
        raf = requestAnimationFrame(animateFlip);
        state.raf = raf;
      } else {
        disposeMesh(topMesh); disposeMesh(bottomMesh);
        topMesh = makePage(topCanvas, 1.325);
        bottomMesh = makePage(bottomCanvas, -1.325);
        if (topMesh) group.add(topMesh);
        if (bottomMesh) group.add(bottomMesh);
        renderer.render(scene, camera);
        finishTurn();
      }
      state.current = n;
      updateNavigation(n);
      overlay.querySelector('.calendar-page-count').textContent = bottomCanvas
        ? `${n}–${Math.min(n + 1, pdf.numPages)} / ${pdf.numPages}`
        : `${n} / ${pdf.numPages}`;
      book.lastPage = n;
      Reader.scheduleSave(book);
      } catch (error) {
        console.error('Gagal membalik halaman kalender', error);
        try {
          disposeFlip();
          disposeMesh(topMesh); disposeMesh(bottomMesh);
          const [fallbackTop, fallbackBottom] = await Promise.all([renderPage(n), n === 1 ? Promise.resolve(null) : renderPage(n + 1)]);
          topMesh = makePage(fallbackTop, 1.325);
          bottomMesh = makePage(fallbackBottom, -1.325);
          if (topMesh) group.add(topMesh);
          if (bottomMesh) group.add(bottomMesh);
          state.current = n;
          updateNavigation(n);
          overlay.querySelector('.calendar-page-count').textContent = fallbackBottom ? `${n}–${Math.min(n + 1, pdf.numPages)} / ${pdf.numPages}` : `${n} / ${pdf.numPages}`;
          book.lastPage = n;
          renderer.render(scene, camera);
        } catch (fallbackError) {
          console.error('Gagal menampilkan halaman kalender', fallbackError);
        }
        finishTurn();
      }
    };
    overlay.querySelector('.calendar-prev').onclick = () => showPage(reader.current === 2 ? 1 : Math.max(2, reader.current - 2), true);
    overlay.querySelector('.calendar-next').onclick = () => showPage(reader.current === 1 ? 2 : reader.current + 2, true);
    overlay.querySelector('.calendar-close').onclick = () => Reader.close();
    const zoomIn = overlay.querySelector('.calendar-zoom-in');
    const zoomOut = overlay.querySelector('.calendar-zoom-out');
    const updateZoom = (delta) => {
      reader.calendarZoom = Math.max(0.7, Math.min(2.5, reader.calendarZoom + delta));
      zoomOut.disabled = reader.calendarZoom <= 0.7;
      zoomIn.disabled = reader.calendarZoom >= 2.5;
      sizeScene();
    };
    zoomIn.onclick = () => updateZoom(0.2);
    zoomOut.onclick = () => updateZoom(-0.2);
    zoomOut.disabled = true;
    overlay.querySelector('.calendar-fullscreen').onclick = () => overlay.requestFullscreen?.();
    const autoplayButton = overlay.querySelector('.calendar-autoplay');
    autoplayButton.onclick = () => {
      if (reader.autoplayTimer) { clearInterval(reader.autoplayTimer); reader.autoplayTimer = null; autoplayButton.setAttribute('aria-pressed', 'false'); }
      else { autoplayButton.setAttribute('aria-pressed', 'true'); reader.autoplayTimer = setInterval(() => { if (reader.current >= pdf.numPages) { clearInterval(reader.autoplayTimer); reader.autoplayTimer = null; autoplayButton.setAttribute('aria-pressed', 'false'); return; } showPage(reader.current === 1 ? 2 : reader.current + 2, true); }, 3000); }
    };
    await showPage(1, false);
    sizeScene();
  },
  async openBook(book) {
    const overlay = document.createElement('section');
    overlay.className = 'book-reader';
    overlay.setAttribute('aria-label', `Buku ${book.name}`);
    overlay.innerHTML = '<iframe class="book-frame" title="Tampilan PDF" allow="fullscreen" allowfullscreen></iframe>';
    document.body.appendChild(overlay);
    document.documentElement.classList.add('flipbook-overflow-hidden');
    const frame = overlay.querySelector('.book-frame');
    const state = { book: true, embeddedBook: true, book, overlay, frame, saveTimer: null };
    reader = state;
    state.onMessage = (event) => {
      if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
      if (event.data?.type === 'han-pustaka-book-page') {
        book.lastPage = event.data.page;
        book.numPages = event.data.numPages;
        Reader.scheduleSave(book);
      } else if (event.data?.type === 'han-pustaka-book-close') Reader.close();
      else if (event.data?.type === 'han-pustaka-book-error') showToast(`Buku gagal dibuka: ${event.data.message}`, 'error');
    };
    window.addEventListener('message', state.onMessage);
    state.onKey = (e) => {
      if (e.target && e.target.tagName === 'INPUT') return;
      const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'PageDown', 'PageUp', ' ', 'Home', 'End', '+', '=', '-', '_', '0'];
      if (!keys.includes(e.key)) return;
      e.preventDefault();
      frame.contentWindow.postMessage({ type: 'han-pustaka-book-key', key: e.key }, location.origin);
    };
    window.addEventListener('keydown', state.onKey);
    frame.addEventListener('load', async () => {
      if (reader !== state) return;
      const data = await book.blob.arrayBuffer();
      if (reader === state) frame.contentWindow.postMessage({ type: 'han-pustaka-open-book', mode: 'book', name: book.name, lastPage: book.lastPage || 1, data }, location.origin, [data]);
    }, { once: true });
    frame.src = 'buku.html?embed=1&mode=book';
  },
  scheduleSave(book) {
    if (!reader) return;
    clearTimeout(reader.saveTimer);
    reader.saveTimer = setTimeout(() => {
      HistoryDB.saveBook(book).catch((e) => console.error('Simpan progress gagal', e));
    }, SAVE_DEBOUNCE_MS);
  },
  injectCloseBtn() {
    const inject = () => {
      const overlay = document.querySelector('.flipbook-overlay');
      if (!overlay) return false;
      if (overlay.querySelector('.flipbook-fullscreen-injected')) return true;
      const fullscreen = document.createElement('button');
      fullscreen.type = 'button';
      fullscreen.className = 'flipbook-lightbox-close flipbook-fullscreen-injected';
      fullscreen.setAttribute('aria-label', 'Layar penuh');
      fullscreen.innerHTML = '<i class="fa fa-expand" aria-hidden="true"></i>';
      fullscreen.addEventListener('click', () => document.querySelector('.flipbook-overlay')?.requestFullscreen?.());
      overlay.appendChild(fullscreen);
      const autoplay = document.createElement('button');
      autoplay.type = 'button';
      autoplay.className = 'flipbook-lightbox-close flipbook-autoplay-injected';
      autoplay.setAttribute('aria-label', 'Putar otomatis');
      autoplay.setAttribute('aria-pressed', 'false');
      autoplay.innerHTML = '<i class="fa fa-play" aria-hidden="true"></i>';
      autoplay.style.left = '16px';
      autoplay.style.right = 'auto';
      autoplay.addEventListener('click', () => {
        if (!reader?.inst) return;
        reader.inst.toggleAutoplay();
        const playing = autoplay.getAttribute('aria-pressed') !== 'true';
        autoplay.setAttribute('aria-pressed', String(playing));
        autoplay.innerHTML = `<i class="fa fa-${playing ? 'pause' : 'play'}" aria-hidden="true"></i>`;
      });
      overlay.appendChild(autoplay);
      return true;
    };
    const timer = setInterval(() => {
      if (inject()) clearInterval(timer);
    }, 200);
    setTimeout(() => clearInterval(timer), 15000);
  },
  close() {
    if (!reader) return;
    if (reader.calendar || reader.embeddedBook) return Reader.teardown();
    const { inst } = reader;
    if (inst.zoom && inst.zoom > 1 && activeBook) activeBook.zoom = inst.zoom;
    if (inst.lightbox) inst.lightbox.closeLightbox.call(inst.lightbox);
    else Reader.teardown();
  },
  teardown() {
    if (!reader) return;
      if (reader.cssCalendar) {
        clearTimeout(reader.saveTimer);
        clearInterval(reader.autoplayTimer);
        reader.pdf.destroy();
        reader.overlay.remove();
        document.documentElement.classList.remove('flipbook-overflow-hidden');
        URL.revokeObjectURL(reader.blobUrl);
        reader = null;
        if (activeBook) HistoryDB.saveBook(activeBook).then(() => refreshShelf()).catch((e) => console.error('Simpan progress gagal', e));
        return;
      }
      if (reader.embeddedCalendar) {
        clearTimeout(reader.saveTimer);
        window.removeEventListener('message', reader.onMessage);
        reader.overlay.remove();
        document.documentElement.classList.remove('flipbook-overflow-hidden');
        reader = null;
        if (activeBook) HistoryDB.saveBook(activeBook).then(() => refreshShelf()).catch((e) => console.error('Simpan progress gagal', e));
        return;
      }
      if (reader.embeddedBook) {
        clearTimeout(reader.saveTimer);
        window.removeEventListener('message', reader.onMessage);
        if (reader.onKey) window.removeEventListener('keydown', reader.onKey);
        reader.overlay.remove();
        document.documentElement.classList.remove('flipbook-overflow-hidden');
        reader = null;
        if (activeBook) HistoryDB.saveBook(activeBook).then(() => refreshShelf()).catch((e) => console.error('Simpan progress gagal', e));
        return;
      }
      if (reader.calendar) {
      clearTimeout(reader.saveTimer);
      clearInterval(reader.autoplayTimer);
      cancelAnimationFrame(reader.raf);
      window.removeEventListener('resize', reader.resize);
      reader.scene.traverse((object) => {
        if (!object.isMesh) return;
        object.geometry.dispose();
        object.material.map?.dispose();
        object.material.dispose();
      });
      if (reader.calendarShadow) {
        reader.calendarShadow.material.map?.dispose();
        reader.calendarShadow.geometry.dispose();
        reader.calendarShadow.material.dispose();
      }
      if (reader.bookShadow) {
        reader.bookShadow.material.map?.dispose();
        reader.bookShadow.geometry.dispose();
        reader.bookShadow.material.dispose();
      }
      if (reader.spineShadow) {
        reader.spineShadow.material.map?.dispose();
        reader.spineShadow.geometry.dispose();
        reader.spineShadow.material.dispose();
      }
      reader.renderer.dispose();
      reader.pdf.destroy();
      reader.overlay.remove();
      document.documentElement.classList.remove('flipbook-overflow-hidden');
      URL.revokeObjectURL(reader.blobUrl);
      reader = null;
      if (activeBook) HistoryDB.saveBook(activeBook).then(() => refreshShelf()).catch((e) => console.error('Simpan progress gagal', e));
      return;
    }
    const { inst, blobUrl } = reader;
    clearTimeout(reader.saveTimer);
    window.jQuery(inst).off('pagechange');
    window.jQuery('.flipbook-overlay, .flipbook-preloader, .flipbook-lightbox-toolbar').remove();
    window.jQuery('body, html').removeClass('flipbook-overflow-hidden');
    bookHost.innerHTML = '';
    bookHost.style.display = 'none';
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    reader = null;
    // Segarkan badge halaman setelah progress tersimpan.
    if (activeBook) {
      HistoryDB.saveBook(activeBook)
        .then(() => refreshShelf())
        .then(() => {
          if (activeBook) Details.open(activeBook);
        })
        .catch((e) => console.error('Simpan progress gagal', e));
    }
  }
};
// Save lastReadAt when page changes
const originalScheduleSave = Reader.scheduleSave;
Reader.scheduleSave = function(book) {
  book.lastReadAt = Date.now();
  originalScheduleSave.call(this, book);
};
// ============================================
// Input file
// ============================================
async function handleFile(file) {
  if (!file) return;
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) {
    showToast('File harus PDF', 'error');
    return;
  }
  const arrayBuffer = await file.arrayBuffer();
  const id = await sha256(arrayBuffer);
  const existing = await HistoryDB.getBook(id);
  if (existing) {
    showToast('Buku sudah ada di rak', 'info');
    Details.open(existing);
    return;
  }
  const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
  const record = {
    id,
    name: file.name.replace(/\.pdf$/i, ''),
    size: file.size,
    blob,
    addedAt: Date.now(),
    sortOrder: allBooks.length,
    lastPage: 0,
    zoom: 1,
    numPages: 0,
    thumbDataUrl: null
  };
  try {
    const { dataUrl, numPages } = await PDFThumb.render(blob);
    record.thumbDataUrl = dataUrl;
    record.numPages = numPages;
  } catch (e) {
    console.warn('Gagal membuat thumbnail', e);
  }
  await HistoryDB.saveBook(record);
  showToast('Buku ditambahkan ke rak', 'success');
  await refreshShelf();
  Details.open(record);
}
// ============================================
// Event
// ============================================
function setupEvents() {
  let uploadDragDepth = 0;
  ['dragenter', 'dragover'].forEach((evt) =>
    uploadDropZone.addEventListener(evt, (e) => {
      if (!Array.from(e.dataTransfer.types).includes('Files')) return;
      e.preventDefault();
      if (evt === 'dragenter') uploadDragDepth++;
      uploadDropZone.classList.add('drag-over');
    })
  );
  uploadDropZone.addEventListener('dragleave', (e) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    uploadDragDepth = Math.max(0, uploadDragDepth - 1);
    if (!uploadDragDepth) uploadDropZone.classList.remove('drag-over');
  });
  uploadDropZone.addEventListener('drop', (e) => {
    uploadDragDepth = 0;
    uploadDropZone.classList.remove('drag-over');
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
  browseBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
    e.target.value = '';
  });
  detailRead.addEventListener('click', () => {
    if (activeBook) Reader.open(activeBook);
  });
  detailDelete.addEventListener('click', () => {
    if (activeBook) removeBook(activeBook);
  });
  document.querySelectorAll('input[name="pdfCategory"]').forEach((input) => {
    input.addEventListener('change', async () => {
      if (!activeBook) return;
      activeBook.category = input.value;
      await HistoryDB.saveBook(activeBook);
      if (reader) Reader.open(activeBook);
    });
  });
  searchForm.addEventListener('submit', (e) => e.preventDefault());
  searchInput.addEventListener('input', () => {
    currentPage = 0;
    applyFilter();
  });
  // Sidebar events
  const brandHome = qs('#brandHome');
  brandHome.addEventListener('click', (e) => {
    e.preventDefault();
    Details.close();
    searchInput.value = '';
    currentPage = 0;
    applyFilter();
  });
}
// ============================================
// Init
// ============================================
async function main() {
  try {
    await HistoryDB.init();
    setupEvents();
    await refreshShelf();
    showToast('HAN-Pustaka siap', 'success');
  } catch (e) {
    console.error('Init error', e);
    showToast('Gagal memuat: ' + e.message, 'error');
  }
}
main();