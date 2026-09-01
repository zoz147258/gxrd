const HOME_SCROLL_KEY = "homeScrollY";
const pdfDocCache = new Map();
let pdfRenderToken = 0;
let lastPreviewWidth = 0;

function getPlatformAttachment(platform) {
  return platform.attachment || `assets/images/${platform.title}.pdf`;
}

function initPdfJs() {
  if (typeof pdfjsLib === "undefined") return;
  pdfjsLib.GlobalWorkerOptions.workerSrc = "js/vendor/pdfjs/pdf.worker.min.js";
}

async function loadPdfDocument(url) {
  if (pdfDocCache.has(url)) {
    return pdfDocCache.get(url);
  }

  if (typeof pdfjsLib === "undefined") {
    throw new Error("PDF.js not loaded");
  }

  const pdf = await pdfjsLib.getDocument(url).promise;
  pdfDocCache.set(url, pdf);
  return pdf;
}

function setActivePdfThumb(thumbsEl, activeIndex) {
  if (!thumbsEl) return;
  thumbsEl.querySelectorAll(".doc-preview__thumb").forEach((thumb, index) => {
    thumb.classList.toggle("is-active", index === activeIndex);
  });
}

function bindPdfPageObserver(pageElements, thumbsEl, scrollEl) {
  if (!thumbsEl || pageElements.length < 2) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const pageIndex = pageElements.indexOf(entry.target);
        if (pageIndex >= 0) {
          setActivePdfThumb(thumbsEl, pageIndex);
        }
      });
    },
    { root: scrollEl, threshold: 0.55 }
  );

  pageElements.forEach((pageEl) => observer.observe(pageEl));
}

async function renderPdfPage(page, scale, options = {}) {
  const { useDevicePixelRatio = true, maxPixelRatio = 2, fitContainer = false } = options;
  const pixelRatio = useDevicePixelRatio
    ? Math.min(window.devicePixelRatio || 1, maxPixelRatio)
    : 1;

  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const outputWidth = Math.floor(viewport.width);
  const outputHeight = Math.floor(viewport.height);

  canvas.width = Math.floor(outputWidth * pixelRatio);
  canvas.height = Math.floor(outputHeight * pixelRatio);

  if (fitContainer) {
    canvas.style.width = "100%";
    canvas.style.height = "auto";
  } else {
    canvas.style.width = `${outputWidth}px`;
    canvas.style.height = `${outputHeight}px`;
  }

  const renderContext = {
    canvasContext: context,
    viewport,
  };

  if (pixelRatio !== 1) {
    renderContext.transform = [pixelRatio, 0, 0, pixelRatio, 0, 0];
  }

  await page.render(renderContext).promise;
  return canvas;
}

function getThumbTargetWidth(thumbsEl) {
  if (!thumbsEl) return 88;

  const styles = window.getComputedStyle(thumbsEl);
  const isHorizontal = styles.flexDirection === "row";

  if (isHorizontal) {
    const thumbWidth = thumbsEl.querySelector(".doc-preview__thumb")?.clientWidth;
    return Math.max(thumbWidth ? thumbWidth - 8 : 48, 40);
  }

  const paddingX =
    parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
  return Math.max(Math.floor(thumbsEl.clientWidth - paddingX - 8), 72);
}

async function renderPdfThumb(page, targetWidth) {
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = targetWidth / baseViewport.width;
  return renderPdfPage(page, scale, {
    maxPixelRatio: 2,
    fitContainer: true,
  });
}

function shouldShowThumbs(thumbsEl) {
  return thumbsEl && !window.matchMedia("(max-width: 1024px)").matches;
}

async function loadAttachmentPreview(platform, viewportEl, thumbsEl) {
  if (!viewportEl) return;

  const attachment = getPlatformAttachment(platform);
  const previewRoot = viewportEl.closest(".doc-preview");
  const scrollEl = viewportEl.closest(".doc-preview__main") || viewportEl;
  const renderToken = ++pdfRenderToken;
  const showThumbs = shouldShowThumbs(thumbsEl);

  if (previewRoot) {
    previewRoot.classList.add("doc-preview--pdf");
  }

  viewportEl.innerHTML = `<div class="pdf-preview__loading">加载中…</div>`;
  if (thumbsEl) {
    thumbsEl.hidden = !showThumbs;
    thumbsEl.innerHTML = "";
  }

  try {
    const pdf = await loadPdfDocument(attachment);
    if (renderToken !== pdfRenderToken) return;

    viewportEl.innerHTML = `<div class="pdf-preview__pages"></div>`;
    const pagesContainer = viewportEl.querySelector(".pdf-preview__pages");
    const pageElements = [];
    const containerWidth = scrollEl.clientWidth || 800;
    const firstPage = await pdf.getPage(1);
    const baseViewport = firstPage.getViewport({ scale: 1 });
    const pageScale = Math.min((containerWidth - 64) / baseViewport.width, 1.35);
    const thumbTargetWidth = showThumbs ? getThumbTargetWidth(thumbsEl) : 0;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = pageNumber === 1 ? firstPage : await pdf.getPage(pageNumber);
      if (renderToken !== pdfRenderToken) return;

      const pageWrap = document.createElement("article");
      pageWrap.className = "pdf-preview__page";
      pageWrap.dataset.page = String(pageNumber);
      pageWrap.appendChild(await renderPdfPage(page, pageScale));
      pagesContainer.appendChild(pageWrap);
      pageElements.push(pageWrap);

      if (showThumbs) {
        const thumbBtn = document.createElement("button");
        thumbBtn.type = "button";
        thumbBtn.className = `doc-preview__thumb${pageNumber === 1 ? " is-active" : ""}`;
        thumbBtn.setAttribute("aria-label", `第 ${pageNumber} 页`);
        thumbBtn.appendChild(await renderPdfThumb(page, thumbTargetWidth));

        thumbBtn.addEventListener("click", () => {
          setActivePdfThumb(thumbsEl, pageNumber - 1);
          pageWrap.scrollIntoView({ behavior: "smooth", block: "start" });
        });

        thumbsEl.appendChild(thumbBtn);
      }
    }

    bindPdfPageObserver(pageElements, showThumbs ? thumbsEl : null, scrollEl);
    lastPreviewWidth = scrollEl.clientWidth || 0;
  } catch (error) {
    if (renderToken !== pdfRenderToken) return;

    viewportEl.innerHTML = `
      <div class="pdf-preview__error">
  
      </div>
    `;
    if (thumbsEl) {
      thumbsEl.innerHTML = "";
      thumbsEl.hidden = true;
    }
  }
}

function saveHomeScrollPosition() {
  if (!document.getElementById("card-grid")) return;
  sessionStorage.setItem(HOME_SCROLL_KEY, String(window.scrollY));
}

function restoreHomeScrollPosition() {
  if (!document.getElementById("card-grid")) return;

  const raw = sessionStorage.getItem(HOME_SCROLL_KEY);
  if (raw === null) return;

  const scrollY = Number(raw);
  if (Number.isNaN(scrollY)) return;

  const applyScroll = () => window.scrollTo(0, scrollY);

  requestAnimationFrame(() => {
    applyScroll();
    requestAnimationFrame(applyScroll);
  });
}

function initHomePageCache() {
  if (history.scrollRestoration) {
    history.scrollRestoration = "manual";
  }

  let scrollTimer;
  window.addEventListener(
    "scroll",
    () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(saveHomeScrollPosition, 100);
    },
    { passive: true }
  );

  window.addEventListener("pagehide", saveHomeScrollPosition);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      restoreHomeScrollPosition();
    }
  });
  window.addEventListener("load", restoreHomeScrollPosition);
}

function renderHomeCards() {
  const grid = document.getElementById("card-grid");
  if (!grid) return;

  grid.innerHTML = PLATFORMS.map(
    (item) => `
    <a class="card" href="detail.html?id=${item.id}" data-id="${item.id}">
      <span class="card__icon" aria-hidden="true">
        <i></i><i></i><i></i><i></i>
      </span>
      <h2 class="card__title">${item.title}</h2>
    </a>
  `
  ).join("");

  grid.addEventListener("click", (event) => {
    const card = event.target.closest("a.card");
    if (!card) return;

    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }

    event.preventDefault();
    sessionStorage.setItem("detailActiveId", card.dataset.id);
    saveHomeScrollPosition();
    openDetailModal(Number(card.dataset.id));
  });
}

function getActiveId() {
  const params = new URLSearchParams(window.location.search);
  const queryId = Number(params.get("id"));

  if (PLATFORMS.some((item) => item.id === queryId)) {
    sessionStorage.setItem("detailActiveId", String(queryId));
    return queryId;
  }

  const storedId = Number(sessionStorage.getItem("detailActiveId"));
  if (PLATFORMS.some((item) => item.id === storedId)) {
    return storedId;
  }

  return PLATFORMS[0].id;
}

function renderDetailTabs(activeId, container) {
  const tabs = container || document.getElementById("detail-tabs");
  if (!tabs) return;

  tabs.innerHTML = PLATFORMS.map(
    (item) => `
    <button
      type="button"
      class="detail-tab${item.id === activeId ? " is-active" : ""}"
      data-id="${item.id}"
    >
      <span class="detail-tab__text">${item.title}</span>
    </button>
  `
  ).join("");
}

function updateActiveTabs(activeId, root = document) {
  root.querySelectorAll(".detail-tab").forEach((tab) => {
    tab.classList.toggle("is-active", Number(tab.dataset.id) === activeId);
  });
}

function updateDetailHero(platform) {
  const titleEl = document.getElementById("detail-hero-title");
  const contactEl = document.getElementById("detail-hero-contact");
  if (titleEl) titleEl.textContent = platform.title;
  if (contactEl) {
    contactEl.textContent = platform.detail?.contact || DETAIL_CONTACT;
  }
}

function switchDetailTab(id, options = {}) {
  const { updateUrl = true, scrollTab = false } = options;
  const platform = PLATFORMS.find((item) => item.id === id);
  if (!platform) return;

  sessionStorage.setItem("detailActiveId", String(id));
  document.title = `${platform.title} - 智慧广西人大`;
  updateDetailHero(platform);
  updateActiveTabs(id);

  loadAttachmentPreview(
    platform,
    document.getElementById("doc-preview-viewport"),
    document.getElementById("doc-preview-thumbs")
  );

  if (updateUrl) {
    const url = new URL(window.location.href);
    url.searchParams.set("id", id);
    window.history.replaceState({ id }, "", url);
  }

  if (scrollTab) {
    requestAnimationFrame(() => {
      document
        .querySelector(`.detail-tab[data-id="${id}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }
}

function openDetailModal(id) {
  const modal = document.getElementById("detail-modal");
  if (!modal) {
    window.location.assign(`detail.html?id=${id}`);
    return;
  }

  const platform = PLATFORMS.find((item) => item.id === id);
  if (!platform) return;

  sessionStorage.setItem("detailActiveId", String(id));

  const contactEl = document.getElementById("detail-modal-contact");
  if (contactEl) {
    contactEl.textContent = platform.detail?.contact || DETAIL_CONTACT;
  }

  renderDetailTabs(id, document.getElementById("modal-detail-tabs"));
  loadAttachmentPreview(
    platform,
    document.getElementById("modal-doc-viewport"),
    document.getElementById("modal-doc-thumbs")
  );

  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeDetailModal() {
  const modal = document.getElementById("detail-modal");
  if (!modal) return;

  pdfRenderToken += 1;
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function switchModalTab(id) {
  const platform = PLATFORMS.find((item) => item.id === id);
  if (!platform) return;

  sessionStorage.setItem("detailActiveId", String(id));
  updateActiveTabs(id, document.getElementById("detail-modal"));

  loadAttachmentPreview(
    platform,
    document.getElementById("modal-doc-viewport"),
    document.getElementById("modal-doc-thumbs")
  );
}

function initModalResize() {
  let resizeTimer;

  window.addEventListener("resize", () => {
    const modal = document.getElementById("detail-modal");
    if (!modal?.classList.contains("is-open")) return;

    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const scrollEl = document
        .getElementById("modal-doc-viewport")
        ?.closest(".doc-preview__main");
      const nextWidth = scrollEl?.clientWidth || 0;

      if (!nextWidth || Math.abs(nextWidth - lastPreviewWidth) < 48) return;

      const activeId = Number(sessionStorage.getItem("detailActiveId")) || PLATFORMS[0].id;
      const platform = PLATFORMS.find((item) => item.id === activeId);
      if (!platform) return;

      loadAttachmentPreview(
        platform,
        document.getElementById("modal-doc-viewport"),
        document.getElementById("modal-doc-thumbs")
      );
    }, 250);
  });
}

function initDetailModal() {
  const modal = document.getElementById("detail-modal");
  if (!modal) return;

  document.getElementById("detail-modal-close")?.addEventListener("click", closeDetailModal);

  document.getElementById("modal-detail-tabs")?.addEventListener("click", (event) => {
    const tab = event.target.closest(".detail-tab");
    if (!tab) return;
    switchModalTab(Number(tab.dataset.id));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.classList.contains("is-open")) {
      closeDetailModal();
    }
  });
}

function initDetailBack() {
  const backBtn = document.getElementById("detail-back");
  if (!backBtn) return;

  backBtn.addEventListener("click", () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.assign("index.html");
  });
}

function initDetailPage() {
  const tabs = document.getElementById("detail-tabs");
  const panel = document.getElementById("detail-panel");
  if (!tabs || !panel) return;

  const activeId = getActiveId();
  renderDetailTabs(activeId);
  switchDetailTab(activeId, { updateUrl: false, scrollTab: true });

  tabs.addEventListener("click", (event) => {
    const tab = event.target.closest(".detail-tab");
    if (!tab) return;
    switchDetailTab(Number(tab.dataset.id));
  });

  window.addEventListener("popstate", () => {
    const id = getActiveId();
    renderDetailTabs(id);
    switchDetailTab(id, { updateUrl: false });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initPdfJs();

  if (document.getElementById("card-grid")) {
    initHomePageCache();
    renderHomeCards();
    restoreHomeScrollPosition();
    initDetailModal();
    initModalResize();
  }
  if (document.getElementById("detail-tabs")) {
    initDetailBack();
    initDetailPage();
  }
});
