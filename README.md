# Visor de imágenes aéreas — Antártida

Mapa interactivo (Leaflet) para explorar fotos aéreas geoetiquetadas por
cruce de hora EXIF contra una trayectoria GPS/INS. Pensado para publicarse
como sitio estático en GitHub Pages.

## Estructura

```
data/
  raw/<fecha>/           fotos originales por fecha de vuelo (NO se sube a git, ver .gitignore)
  <trayectoria>.txt      tabla de trayectoria GPS/INS (UTCTime, ECEF X/Y/Z, Lon, Lat, H-Ell, Roll, Pitch, Heading)
scripts/
  geotag.js              cruza fotos + trayectoria, genera docs/manifest.json y docs/thumbs/
docs/                    sitio estático (esto es lo que se publica en GitHub Pages)
  index.html, app.js, style.css
  manifest.json          generado por geotag.js — no editar a mano
  thumbs/<fecha>/         miniaturas (~1600px) generadas por geotag.js
  vendor/leaflet/         Leaflet y leaflet.markercluster empaquetados localmente
```

## Agregar un nuevo día de vuelo

1. Copiar las fotos JPEG a `data/raw/<YYYY-MM-DD>/`.
2. Guardar la tabla de trayectoria de ese vuelo (mismo formato de columnas)
   en `data/<algo>.txt`.
3. Ejecutar:

   ```
   node scripts/geotag.js \
     --track data/<archivo_trayectoria>.txt \
     --photos data/raw/<YYYY-MM-DD> \
     --date <YYYY-MM-DD> \
     --offset 0 \
     --tolerance 5
   ```

   - `--offset`: segundos a sumar a la hora EXIF de la foto para alinearla
     con `UTCTime` de la trayectoria. Aún no se ha determinado el desfase
     real entre el reloj de la cámara y el GPS/INS — ajustar este valor
     cuando se conozca (por ejemplo comparando la hora de una foto de un
     evento conocido, como despegue/aterrizaje, contra la trayectoria).
   - `--tolerance`: segundos máximos de diferencia aceptados. Las fotos
     que superen la tolerancia igual se geoetiquetan (con la posición más
     cercana disponible) pero quedan marcadas en la consola y en el
     manifest (`matchDeltaSeconds`) para revisión manual.
   - El script fusiona el resultado con `docs/manifest.json` existente
     (reemplaza solo las entradas de la misma fecha), así que se puede
     correr repetidas veces para distintos días sin perder datos previos.

4. Revisar en consola cuántas fotos quedaron marcadas con desfase alto.
5. Probar localmente (ver abajo) y hacer commit de `docs/` (NO de `data/raw/`).

## Probar localmente

```
npx http-server docs -p 5173 -c-1
```

y abrir http://localhost:5173

## Publicar en GitHub Pages

Repo: https://github.com/joberreuter/antartica-viewer
Sitio: https://joberreuter.github.io/antartica-viewer/

GitHub Pages ya está configurado para servir la carpeta `docs/` de la
rama `master` (Settings → Pages → "Deploy from a branch" → `master` /
`/docs`). Cada vez que se agregue un nuevo día de vuelo: correr
`geotag.js`, revisar el resultado, y hacer commit + push de `docs/`
(GitHub Pages se actualiza solo en 1-2 minutos tras el push).

## Pendiente / decisiones abiertas

- **Offset de reloj cámara↔GPS/INS**: por confirmar. Mientras tanto se
  usa `--offset 0`.
- **Fotos en resolución completa**: el sitio solo publica miniaturas
  (~1600px) para no inflar el repositorio con miles de fotos de ~10MB.
  Falta decidir cómo enlazar/mostrar la foto original en alta resolución
  (por ejemplo, un enlace a Google Drive por archivo).
