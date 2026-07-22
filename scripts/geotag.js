#!/usr/bin/env node
// Cruza fotos (EXIF DateTimeOriginal) con una tabla de trayectoria GPS/INS
// (columnas: UTCTime X-ECEF Y-ECEF Z-ECEF Longitude Latitude H-Ell Roll Pitch Heading)
// y genera site/manifest.json + miniaturas en site/thumbs/<date>/.
//
// Uso:
//   node scripts/geotag.js --track data/sample_trajectory.txt --photos data/raw/20231121 \
//     --date 2023-11-21 --offset 0 --tolerance 5 --out site/manifest.json
//
// --offset: segundos a sumar a la hora EXIF de la foto para alinearla con UTCTime
//           de la trayectoria (ajustar cuando se conozca el desfase real cámara/GPS).
// --tolerance: segundos máximos de diferencia permitidos para aceptar un match.

const fs = require('fs');
const path = require('path');
const exifr = require('exifr');
const sharp = require('sharp');

function parseArgs(argv) {
  const args = { offset: 0, tolerance: 5, thumbWidth: 1600 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      args[key] = val;
      i++;
    }
  }
  return args;
}

function loadTrajectory(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const rows = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || !/^\d{2}:\d{2}:\d{2}/.test(t)) continue; // skip header/blank lines
    const parts = t.split(/\s+/);
    if (parts.length < 10) continue;
    const [utcTime, , , , lon, lat, hEll, roll, pitch, heading] = parts;
    const [hh, mm, ssFrac] = utcTime.split(':');
    const secondsOfDay =
      parseInt(hh, 10) * 3600 + parseInt(mm, 10) * 60 + parseFloat(ssFrac);
    rows.push({
      secondsOfDay,
      lon: parseFloat(lon),
      lat: parseFloat(lat),
      hEll: parseFloat(hEll),
      roll: parseFloat(roll),
      pitch: parseFloat(pitch),
      heading: parseFloat(heading),
    });
  }
  rows.sort((a, b) => a.secondsOfDay - b.secondsOfDay);
  return rows;
}

// Busca las dos filas mas cercanas al tiempo objetivo e interpola linealmente.
function interpolate(rows, targetSeconds) {
  if (rows.length === 0) return null;
  if (targetSeconds <= rows[0].secondsOfDay) {
    return { row: rows[0], delta: rows[0].secondsOfDay - targetSeconds };
  }
  if (targetSeconds >= rows[rows.length - 1].secondsOfDay) {
    const last = rows[rows.length - 1];
    return { row: last, delta: targetSeconds - last.secondsOfDay };
  }
  // binary search for the bracketing pair
  let lo = 0, hi = rows.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].secondsOfDay <= targetSeconds) lo = mid;
    else hi = mid;
  }
  const a = rows[lo], b = rows[hi];
  const span = b.secondsOfDay - a.secondsOfDay;
  const f = span === 0 ? 0 : (targetSeconds - a.secondsOfDay) / span;
  const lerp = (x, y) => x + (y - x) * f;
  return {
    row: {
      secondsOfDay: targetSeconds,
      lon: lerp(a.lon, b.lon),
      lat: lerp(a.lat, b.lat),
      hEll: lerp(a.hEll, b.hEll),
      roll: lerp(a.roll, b.roll),
      pitch: lerp(a.pitch, b.pitch),
      heading: lerp(a.heading, b.heading),
    },
    delta: 0,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.track || !args.photos || !args.date) {
    console.error(
      'Uso: node scripts/geotag.js --track <trayectoria.txt> --photos <carpeta> --date YYYY-MM-DD ' +
      '[--offset segundos] [--tolerance segundos] [--out site/manifest.json] [--thumbWidth 1600]'
    );
    process.exit(1);
  }

  const offset = parseFloat(args.offset);
  const tolerance = parseFloat(args.tolerance);
  const outPath = args.out || 'site/manifest.json';
  const thumbWidth = parseInt(args.thumbWidth, 10);
  const dateFolder = args.date; // usado para nombrar la subcarpeta de miniaturas

  const rows = loadTrajectory(args.track);
  if (rows.length === 0) {
    console.error('No se pudo leer ninguna fila de trayectoria en', args.track);
    process.exit(1);
  }

  const photoFiles = fs
    .readdirSync(args.photos)
    .filter((f) => /\.(jpe?g)$/i.test(f));

  const thumbsDir = path.join('site', 'thumbs', dateFolder);
  fs.mkdirSync(thumbsDir, { recursive: true });

  // Existing manifest is merged so re-running geotag.js for a new date
  // folder doesn't wipe out entries from previously processed dates.
  let manifest = [];
  if (fs.existsSync(outPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    } catch {
      manifest = [];
    }
  }
  manifest = manifest.filter((m) => m.date !== dateFolder);

  let matched = 0;
  let flagged = 0;

  for (const file of photoFiles) {
    const fullPath = path.join(args.photos, file);
    const exif = await exifr.parse(fullPath, { pick: ['DateTimeOriginal'] });
    if (!exif || !exif.DateTimeOriginal) {
      console.warn('  sin EXIF DateTimeOriginal, se omite:', file);
      continue;
    }
    const d = exif.DateTimeOriginal;
    const secondsOfDay =
      d.getUTCHours() * 3600 +
      d.getUTCMinutes() * 60 +
      d.getUTCSeconds() +
      offset;

    const match = interpolate(rows, secondsOfDay);
    if (!match) continue;
    if (match.delta > tolerance) {
      flagged++;
      console.warn(
        `  [!] ${file}: diferencia de ${match.delta.toFixed(1)}s con la trayectoria (> tolerancia ${tolerance}s)`
      );
    } else {
      matched++;
    }

    const id = path.basename(file, path.extname(file));
    const thumbFile = `${id}.jpg`;
    const thumbPath = path.join(thumbsDir, thumbFile);
    await sharp(fullPath).rotate().resize({ width: thumbWidth }).jpeg({ quality: 82 }).toFile(thumbPath);

    manifest.push({
      id,
      date: dateFolder,
      thumb: path.posix.join('thumbs', dateFolder, thumbFile),
      lat: match.row.lat,
      lon: match.row.lon,
      alt: match.row.hEll,
      heading: match.row.heading,
      timestamp: d.toISOString(),
      matchDeltaSeconds: Math.round(match.delta * 100) / 100,
    });
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));

  console.log(`\nListo. ${matched} fotos geoetiquetadas dentro de tolerancia, ${flagged} marcadas con desfase alto.`);
  console.log('Manifest:', outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
