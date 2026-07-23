(async function () {
  const map = L.map('map', { worldCopyJump: true }).setView([-62.5, -58.5], 6);

  const satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles &copy; Esri', maxZoom: 18 }
  ).addTo(map);

  const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  });

  L.control.scale({ imperial: false }).addTo(map);

  const infoCount = document.getElementById('info-count');

  let photos = [];
  try {
    const res = await fetch('manifest.json');
    photos = await res.json();
  } catch (err) {
    infoCount.textContent = 'No se pudo cargar manifest.json';
    console.error(err);
    return;
  }

  photos.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  infoCount.textContent = `${photos.length} foto${photos.length === 1 ? '' : 's'} geoetiquetada${photos.length === 1 ? '' : 's'}`;

  function newClusterGroup() {
    const group = L.markerClusterGroup({
      maxClusterRadius: 40,
      zoomToBoundsOnClick: false,
      spiderfyOnMaxZoom: false,
    });
    // Clic en un cluster: abre directamente la primera foto (por hora) del
    // grupo, sin hacer zoom ni spiderfy.
    group.on('clusterclick', (e) => {
      const children = e.layer.getAllChildMarkers();
      if (!children.length) return;
      const firstIndex = Math.min(...children.map((m) => m.photoIndex));
      openLightbox(firstIndex);
    });
    return group;
  }

  const clustersByDate = {};
  const dateCounts = {};
  for (const p of photos) {
    if (!clustersByDate[p.date]) {
      clustersByDate[p.date] = newClusterGroup();
      dateCounts[p.date] = 0;
    }
    dateCounts[p.date]++;
  }

  const markers = [];
  const bounds = [];

  photos.forEach((p, index) => {
    const marker = L.marker([p.lat, p.lon], {
      icon: L.divIcon({
        className: 'photo-marker',
        html: '<div style="width:12px;height:12px;border-radius:50%;background:#ff5a3c;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.6);"></div>',
        iconSize: [12, 12],
      }),
    });

    const popupHtml = `
      <div class="photo-popup">
        <img src="${p.thumb}" data-index="${index}" alt="${p.id}" />
        <div class="meta">
          ${p.id}<br/>
          ${new Date(p.timestamp).toLocaleString()}<br/>
          ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}
        </div>
      </div>`;

    marker.photoIndex = index;
    marker.bindPopup(popupHtml);
    marker.on('popupopen', (e) => {
      const img = e.popup.getElement().querySelector('img');
      if (img) img.addEventListener('click', () => openLightbox(index));
    });

    clustersByDate[p.date].addLayer(marker);
    markers.push(marker);
    bounds.push([p.lat, p.lon]);
  });

  const dateOverlays = {};
  Object.keys(clustersByDate)
    .sort()
    .forEach((date) => {
      const group = clustersByDate[date];
      map.addLayer(group);
      dateOverlays[`${date} (${dateCounts[date]})`] = group;
    });

  L.control
    .layers({ Satélite: satellite, Calles: streets }, dateOverlays, { collapsed: false })
    .addTo(map);

  if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });

  // --- Lightbox ---
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxCaption = document.getElementById('lightbox-caption');
  let currentIndex = 0;

  function openLightbox(index) {
    currentIndex = index;
    renderLightbox();
    lightbox.classList.remove('hidden');
  }

  function renderLightbox() {
    const p = photos[currentIndex];
    lightboxImg.src = p.thumb;
    lightboxImg.alt = p.id;
    lightboxCaption.textContent = `${p.id} — ${new Date(p.timestamp).toLocaleString()} — ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)} — rumbo ${p.heading.toFixed(1)}°`;
  }

  function closeLightbox() {
    lightbox.classList.add('hidden');
  }

  function step(delta) {
    currentIndex = (currentIndex + delta + photos.length) % photos.length;
    renderLightbox();
  }

  document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
  document.getElementById('lightbox-prev').addEventListener('click', () => step(-1));
  document.getElementById('lightbox-next').addEventListener('click', () => step(1));
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (lightbox.classList.contains('hidden')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });
})();
