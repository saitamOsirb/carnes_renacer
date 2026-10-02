import { LabelManager } from "@/components/admin/label-manager";
import { getLabelManagerData } from "@/lib/label-service";

export const dynamic = "force-dynamic";

export default async function LabelsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [{ template, products }, query] = await Promise.all([getLabelManagerData(), searchParams]);

  return (
    <div className="admin-content label-page">
      <div className="admin-title-row">
        <div>
          <span className="admin-kicker">Catálogo</span>
          <h1>Gestor de etiquetas</h1>
          <p>Diseña, previsualiza e imprime etiquetas usando siempre el nombre, precio, unidad e identificación vigente del producto.</p>
        </div>
        <div className="admin-stat"><strong>{products.length}</strong><span>productos activos</span></div>
      </div>

      {query.ok && <div className="admin-alert admin-alert-ok">{query.ok}</div>}
      {query.error && <div className="admin-alert admin-alert-error">{query.error}</div>}

      <div className="admin-inline-notice label-info-notice">
        Los códigos de barras se administran en Productos. El gestor no crea precios ni códigos paralelos: solo compone etiquetas con los datos actuales del catálogo.
      </div>

      <LabelManager initialTemplate={template} products={products} />
    </div>
  );
}
