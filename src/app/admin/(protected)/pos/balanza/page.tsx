import Link from "next/link";
import { saveScaleBarcodeConfig } from "@/app/admin/scale-actions";
import { prisma } from "@/lib/prisma";
import {
  SCALE_PLU_PREFIX,
  SCALE_PRICE_DIVISOR_KEY,
  SCALE_PRICE_PREFIXES_KEY,
  SCALE_WEIGHT_PREFIXES_KEY,
  buildScaleBarcodeConfig,
} from "@/lib/scale-barcode";

export const dynamic = "force-dynamic";

export default async function ScaleSettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const query = await searchParams;
  const [settings, pluCount] = await Promise.all([
    prisma.storeSetting.findMany({
      where: { key: { in: [SCALE_WEIGHT_PREFIXES_KEY, SCALE_PRICE_PREFIXES_KEY, SCALE_PRICE_DIVISOR_KEY] } },
      select: { key: true, value: true },
    }),
    prisma.storeSetting.count({ where: { key: { startsWith: SCALE_PLU_PREFIX } } }),
  ]);
  const values = new Map(settings.map((setting) => [setting.key, setting.value]));
  const config = buildScaleBarcodeConfig({
    weightPrefixes: values.get(SCALE_WEIGHT_PREFIXES_KEY),
    pricePrefixes: values.get(SCALE_PRICE_PREFIXES_KEY),
    priceDivisor: values.get(SCALE_PRICE_DIVISOR_KEY),
  });

  return (
    <div className="admin-content admin-content-narrow">
      <div className="admin-title-row">
        <div>
          <span className="admin-kicker">POS</span>
          <h1>Integración de balanza</h1>
          <p>Configura etiquetas EAN-13 de peso variable para que el POS reconozca producto y cantidad automáticamente.</p>
        </div>
        <Link className="admin-button admin-button-secondary" href="/admin/productos">Asignar PLU a productos</Link>
      </div>

      {query.ok && <div className="admin-alert admin-alert-ok">{query.ok}</div>}
      {query.error && <div className="admin-alert admin-alert-error">{query.error}</div>}

      <section className="admin-stats-grid">
        <div className="admin-stat"><strong>{pluCount}</strong><span>productos con PLU</span></div>
        <div className="admin-stat"><strong>{config.weightPrefixes.length}</strong><span>prefijos de peso</span></div>
        <div className="admin-stat"><strong>{config.pricePrefixes.length}</strong><span>prefijos de importe</span></div>
      </section>

      <section className="admin-card">
        <div className="admin-card-heading">
          <div>
            <h2>Formato EAN-13</h2>
            <p>El formato soportado es: prefijo de 2 dígitos + PLU de 5 dígitos + dato variable de 5 dígitos + dígito verificador.</p>
          </div>
        </div>
        <div className="admin-inline-notice">
          <strong>Peso:</strong> <code>20 01234 00742 C</code> → PLU 01234 y 742 g = 0,742 kg.<br />
          <strong>Importe:</strong> <code>21 01234 15575 C</code> → PLU 01234 y $15.575; el POS deriva el peso usando el precio/kg vigente.
        </div>

        <form action={saveScaleBarcodeConfig} className="admin-form" style={{ marginTop: 20 }}>
          <label>
            Prefijos que codifican peso
            <input name="weightPrefixes" defaultValue={config.weightPrefixes.join(",")} placeholder="20,22" />
            <small>Solo 20–29. El dato variable se interpreta como gramos.</small>
          </label>
          <label>
            Prefijos que codifican importe
            <input name="pricePrefixes" defaultValue={config.pricePrefixes.join(",")} placeholder="21,23" />
            <small>Déjalo vacío si tu balanza imprime únicamente peso.</small>
          </label>
          <label>
            Divisor del importe codificado
            <select name="priceDivisor" defaultValue={String(config.priceDivisor)}>
              <option value="1">1 · importe directo en CLP</option>
              <option value="10">10</option>
              <option value="100">100 · dos decimales codificados</option>
              <option value="1000">1000</option>
            </select>
            <small>Para Chile normalmente corresponde 1.</small>
          </label>
          <button className="admin-button admin-button-primary" type="submit">Guardar configuración</button>
        </form>
      </section>

      <section className="admin-card">
        <div className="admin-card-heading"><div><h2>Cómo usarlo</h2><p>No necesitas un driver especial si la balanza imprime una etiqueta que el lector entrega como EAN-13.</p></div></div>
        <ol>
          <li>Asigna a cada producto KG un PLU de exactamente 5 dígitos desde Productos.</li>
          <li>Configura aquí los prefijos que usa tu balanza para peso o importe.</li>
          <li>Imprime la etiqueta desde la balanza y escanéala en el POS con lector USB/Bluetooth o cámara.</li>
          <li>El POS agrega automáticamente el peso de esa etiqueta al carrito y valida el stock disponible.</li>
        </ol>
        <div className="admin-inline-notice">Los códigos de barras normales tienen prioridad. Una etiqueta de balanza solo se interpreta como variable cuando no existe una asociación exacta para ese código completo.</div>
      </section>
    </div>
  );
}
