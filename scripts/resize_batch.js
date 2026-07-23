#!/usr/bin/env node
// Genera copias livianas (redimensionadas) de un lote de fotos JPEG,
// preservando el EXIF (fecha/hora, GPS si tuviera) para que las copias
// livianas puedan seguir usándose como fuente de geotag.js.
//
// Uso:
//   node scripts/resize_batch.js --input <carpeta_origen> --output <carpeta_destino> \
//     [--width 1600] [--quality 82] [--concurrency 4]
//
// Se puede interrumpir y volver a correr: las fotos ya convertidas
// (mismo nombre + mismo tamaño de origen) se saltan.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

function parseArgs(argv) {
  const args = { width: 1600, quality: 82, concurrency: 4 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      args[a.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

async function runPool(items, concurrency, worker) {
  let i = 0;
  let done = 0;
  const total = items.length;
  const startedAt = Date.now();

  async function next() {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx]);
      done++;
      if (done % 50 === 0 || done === total) {
        const elapsedS = (Date.now() - startedAt) / 1000;
        const rate = done / elapsedS;
        const etaS = rate > 0 ? (total - done) / rate : 0;
        console.log(
          `  ${done}/${total} (${rate.toFixed(1)}/s, ETA ${Math.round(etaS / 60)} min)`
        );
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, next));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input || !args.output) {
    console.error(
      'Uso: node scripts/resize_batch.js --input <carpeta> --output <carpeta> ' +
      '[--width 1600] [--quality 82] [--concurrency 4]'
    );
    process.exit(1);
  }

  const width = parseInt(args.width, 10);
  const quality = parseInt(args.quality, 10);
  const concurrency = parseInt(args.concurrency, 10);

  fs.mkdirSync(args.output, { recursive: true });

  const files = fs
    .readdirSync(args.input)
    .filter((f) => /\.(jpe?g)$/i.test(f));

  console.log(`Encontradas ${files.length} fotos en ${args.input}`);
  console.log(`Destino: ${args.output} (ancho ${width}px, calidad ${quality})`);

  let skipped = 0;
  let converted = 0;
  let failed = 0;

  await runPool(files, concurrency, async (file) => {
    const inPath = path.join(args.input, file);
    const outPath = path.join(args.output, file);

    if (fs.existsSync(outPath)) {
      const inSize = fs.statSync(inPath).size;
      const marker = outPath + '.srcsize';
      if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === String(inSize)) {
        skipped++;
        return;
      }
    }

    try {
      await sharp(inPath)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .withMetadata()
        .jpeg({ quality })
        .toFile(outPath);
      fs.writeFileSync(outPath + '.srcsize', String(fs.statSync(inPath).size));
      converted++;
    } catch (err) {
      failed++;
      console.warn(`  [!] Error en ${file}: ${err.message}`);
    }
  });

  console.log(
    `\nListo. Convertidas: ${converted}, ya existentes (saltadas): ${skipped}, fallidas: ${failed}.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
