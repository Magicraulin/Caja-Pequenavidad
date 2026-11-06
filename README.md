# Caja Pequenavidad

App para apuntar las ventas diarias del puesto de Pequenavidad, ver el stock y el beneficio por artículo. Se instala en el móvil como una app y guarda los datos en una hoja de Google Sheets.

## Cómo funciona

- **La app** (esta carpeta) se publica gratis con GitHub Pages.
- **Los datos** viven en la hoja de Google «Caja Pequenavidad» (pestañas *Resumen por día*, *Productos* y *Ventas*).
- **El puente** entre las dos es el código de `apps-script/Code.gs`, que se pega en la hoja (Extensiones → Apps Script).

## Dos PIN

| PIN | Qué puede hacer |
|---|---|
| Administrador | Todo: cualquier día, productos, precios, stock y beneficios |
| Tienda | Solo apuntar o corregir las ventas **de hoy** y ver el stock. No ve costes ni beneficios |

La restricción la aplica Google en el servidor, no solo la pantalla. Los PIN **no están en este repositorio**: se guardan en las propiedades del script de Apps Script. Tras 8 PIN fallidos seguidos, la entrada se bloquea 10 minutos.

## Puesta en marcha (una sola vez)

1. Abre la hoja «Caja Pequenavidad» en Google Drive → **Extensiones → Apps Script**.
2. Borra lo que haya y pega el contenido de `apps-script/Code.gs`. Guarda.
3. En la función `configurarPins`, escribe los dos PIN, elige `configurarPins` arriba y pulsa **Ejecutar**. Acepta los permisos. Después borra los números y vuelve a guardar.
4. **Implementar → Nueva implementación → Aplicación web**. *Ejecutar como*: yo. *Quién tiene acceso*: cualquier usuario. Copia la URL que termina en `/exec`.
5. Pega esa URL en `config.js` (`API_URL`).

## Instalar en el móvil

- **iPhone**: abre la web en Safari → Compartir → Añadir a pantalla de inicio.
- **Android**: abre la web en Chrome → menú ⋮ → Instalar aplicación.
