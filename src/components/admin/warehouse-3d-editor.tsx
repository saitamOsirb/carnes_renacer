"use client";

import Image from "next/image";
import { useMemo, useRef, useState, type PointerEvent } from "react";
import { saveWarehouseScene } from "@/app/admin/warehouse-map-actions";

type ObjectType =
  | "RACK"
  | "PALLET"
  | "COLD_ROOM"
  | "FREEZER"
  | "FRIDGE"
  | "TABLE"
  | "WALL"
  | "DOOR"
  | "RECEIVING"
  | "DISPATCH"
  | "CUSTOM";

type LocatedProduct = {
  id: string;
  name: string;
  imageUrl: string;
  available: number;
  onHand: number;
  reserved: number;
  unit: "KG" | "UNIT";
  locationCode: string | null;
};

export type WarehouseSceneObject = {
  id: string;
  type: ObjectType;
  label: string;
  xCm: number;
  zCm: number;
  widthCm: number;
  depthCm: number;
  heightCm: number;
  rotation: number;
  products: LocatedProduct[];
};

type Props = {
  warehouseId: string;
  widthCm: number;
  depthCm: number;
  heightCm: number;
  initialObjects: WarehouseSceneObject[];
};

type DragState = {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originZ: number;
};

const typeLabels: Record<ObjectType, string> = {
  RACK: "Rack",
  PALLET: "Pallet",
  COLD_ROOM: "Cámara frío",
  FREEZER: "Congelador",
  FRIDGE: "Refrigerador",
  TABLE: "Mesón",
  WALL: "Muro",
  DOOR: "Puerta",
  RECEIVING: "Recepción",
  DISPATCH: "Despacho",
  CUSTOM: "Objeto",
};

const objectDefaults: Record<ObjectType, { widthCm: number; depthCm: number; heightCm: number }> = {
  RACK: { widthCm: 250, depthCm: 80, heightCm: 220 },
  PALLET: { widthCm: 120, depthCm: 100, heightCm: 20 },
  COLD_ROOM: { widthCm: 350, depthCm: 300, heightCm: 260 },
  FREEZER: { widthCm: 200, depthCm: 90, heightCm: 120 },
  FRIDGE: { widthCm: 140, depthCm: 80, heightCm: 210 },
  TABLE: { widthCm: 180, depthCm: 80, heightCm: 90 },
  WALL: { widthCm: 300, depthCm: 15, heightCm: 250 },
  DOOR: { widthCm: 100, depthCm: 20, heightCm: 220 },
  RECEIVING: { widthCm: 250, depthCm: 180, heightCm: 15 },
  DISPATCH: { widthCm: 250, depthCm: 180, heightCm: 15 },
  CUSTOM: { widthCm: 150, depthCm: 120, heightCm: 100 },
};

function unitLabel(unit: LocatedProduct["unit"]): string {
  return unit === "KG" ? "kg" : "un.";
}

function meters(cm: number): string {
  return (cm / 100).toFixed(cm % 100 === 0 ? 0 : 2);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function Warehouse3DEditor({ warehouseId, widthCm, depthCm, heightCm, initialObjects }: Props) {
  const [objects, setObjects] = useState(initialObjects);
  const [view, setView] = useState<"PLAN" | "3D">("PLAN");
  const [selectedId, setSelectedId] = useState(initialObjects[0]?.id ?? "");
  const [drag, setDrag] = useState<DragState | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const newCounter = useRef(0);

  const selected = objects.find((object) => object.id === selectedId) ?? null;
  const persistedScene = useMemo(() => JSON.stringify(objects.map(({ products: _products, ...object }) => object)), [objects]);

  function updateObject(id: string, patch: Partial<WarehouseSceneObject>) {
    setObjects((current) => current.map((object) => object.id === id ? { ...object, ...patch } : object));
  }

  function addObject(type: ObjectType) {
    const defaults = objectDefaults[type];
    const sequence = objects.filter((object) => object.type === type).length + 1;
    const id = `new-${Date.now()}-${newCounter.current++}`;
    const object: WarehouseSceneObject = {
      id,
      type,
      label: `${typeLabels[type]} ${sequence}`,
      xCm: clamp(60 + sequence * 20, 0, Math.max(0, widthCm - defaults.widthCm)),
      zCm: clamp(60 + sequence * 20, 0, Math.max(0, depthCm - defaults.depthCm)),
      widthCm: Math.min(defaults.widthCm, widthCm),
      depthCm: Math.min(defaults.depthCm, depthCm),
      heightCm: Math.min(defaults.heightCm, heightCm),
      rotation: 0,
      products: [],
    };
    setObjects((current) => [...current, object]);
    setSelectedId(id);
  }

  function removeSelected() {
    if (!selected) return;
    setObjects((current) => current.filter((object) => object.id !== selected.id));
    setSelectedId("");
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>, object: WarehouseSceneObject) {
    if (!boardRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedId(object.id);
    setDrag({
      id: object.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: object.xCm,
      originZ: object.zCm,
    });
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>, object: WarehouseSceneObject) {
    if (!drag || drag.id !== object.id || drag.pointerId !== event.pointerId || !boardRef.current) return;
    const rect = boardRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const deltaX = ((event.clientX - drag.startX) / rect.width) * widthCm;
    const deltaZ = ((event.clientY - drag.startY) / rect.height) * depthCm;
    updateObject(object.id, {
      xCm: Math.round(clamp(drag.originX + deltaX, 0, Math.max(0, widthCm - object.widthCm))),
      zCm: Math.round(clamp(drag.originZ + deltaZ, 0, Math.max(0, depthCm - object.depthCm))),
    });
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    if (drag?.pointerId === event.pointerId) setDrag(null);
  }

  function numericPatch(key: "xCm" | "zCm" | "widthCm" | "depthCm" | "heightCm", raw: string) {
    if (!selected) return;
    const value = Number(raw.replace(",", "."));
    if (!Number.isFinite(value)) return;
    const cm = Math.max(key === "heightCm" ? 5 : key === "xCm" || key === "zCm" ? 0 : 10, Math.round(value * 100));
    const patch: Partial<WarehouseSceneObject> = { [key]: cm };
    if (key === "xCm") patch.xCm = clamp(cm, 0, Math.max(0, widthCm - selected.widthCm));
    if (key === "zCm") patch.zCm = clamp(cm, 0, Math.max(0, depthCm - selected.depthCm));
    if (key === "widthCm") {
      patch.widthCm = clamp(cm, 10, widthCm);
      patch.xCm = clamp(selected.xCm, 0, Math.max(0, widthCm - patch.widthCm));
    }
    if (key === "depthCm") {
      patch.depthCm = clamp(cm, 10, depthCm);
      patch.zCm = clamp(selected.zCm, 0, Math.max(0, depthCm - patch.depthCm));
    }
    if (key === "heightCm") patch.heightCm = clamp(cm, 5, heightCm);
    updateObject(selected.id, patch);
  }

  return (
    <section className="warehouse-editor-shell">
      <div className="warehouse-editor-toolbar">
        <div>
          <span className="admin-kicker">Editor visual</span>
          <h2>Diseña la bodega</h2>
          <p>{meters(widthCm)} m × {meters(depthCm)} m × {meters(heightCm)} m · {objects.length} objetos</p>
        </div>
        <div className="warehouse-view-toggle" role="group" aria-label="Vista del editor">
          <button type="button" className={view === "PLAN" ? "is-active" : ""} onClick={() => setView("PLAN")}>Planta</button>
          <button type="button" className={view === "3D" ? "is-active" : ""} onClick={() => setView("3D")}>Vista 3D</button>
        </div>
        <form action={saveWarehouseScene}>
          <input type="hidden" name="warehouseId" value={warehouseId} />
          <input type="hidden" name="scene" value={persistedScene} />
          <button className="admin-button admin-button-primary" type="submit">Guardar plano</button>
        </form>
      </div>

      <div className="warehouse-editor-grid">
        <aside className="warehouse-object-palette">
          <strong>Objetos</strong>
          <p>Agrega elementos y muévelos sobre el plano.</p>
          <div className="warehouse-palette-grid">
            {(Object.keys(typeLabels) as ObjectType[]).map((type) => (
              <button type="button" key={type} onClick={() => addObject(type)}>
                <span className={`warehouse-object-icon type-${type.toLowerCase().replaceAll("_", "-")}`} aria-hidden="true" />
                {typeLabels[type]}
              </button>
            ))}
          </div>
        </aside>

        <div className="warehouse-canvas-card">
          {view === "PLAN" ? (
            <div className="warehouse-plan-wrap">
              <div className="warehouse-ruler warehouse-ruler-x"><span>0 m</span><span>{meters(widthCm)} m</span></div>
              <div
                ref={boardRef}
                className="warehouse-plan-board"
                style={{ aspectRatio: `${Math.max(widthCm, 1)} / ${Math.max(depthCm, 1)}` }}
              >
                {objects.length === 0 && <div className="warehouse-empty-canvas">Agrega racks, cámaras u otros objetos desde el panel izquierdo.</div>}
                {objects.map((object) => (
                  <button
                    type="button"
                    key={object.id}
                    className={`warehouse-plan-object type-${object.type.toLowerCase().replaceAll("_", "-")}${selectedId === object.id ? " is-selected" : ""}`}
                    style={{
                      left: `${(object.xCm / widthCm) * 100}%`,
                      top: `${(object.zCm / depthCm) * 100}%`,
                      width: `${(object.widthCm / widthCm) * 100}%`,
                      height: `${(object.depthCm / depthCm) * 100}%`,
                    }}
                    onPointerDown={(event) => startDrag(event, object)}
                    onPointerMove={(event) => moveDrag(event, object)}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                  >
                    <strong>{object.label}</strong>
                    <small>{meters(object.widthCm)}×{meters(object.depthCm)} m</small>
                    {object.products.length > 0 && <span className="warehouse-object-products">{object.products.slice(0, 3).map((product) => <Image key={product.id} src={product.imageUrl} alt="" width={28} height={28} />)}{object.products.length > 3 && <em>+{object.products.length - 3}</em>}</span>}
                  </button>
                ))}
              </div>
              <div className="warehouse-ruler warehouse-ruler-z"><span>Profundidad {meters(depthCm)} m</span></div>
            </div>
          ) : (
            <div className="warehouse-3d-stage" aria-label="Vista tridimensional de la bodega">
              <div className="warehouse-3d-back-wall" />
              <div className="warehouse-3d-floor" />
              {objects.map((object) => {
                const x = (object.xCm + object.widthCm / 2) / widthCm;
                const z = (object.zCm + object.depthCm / 2) / depthCm;
                const left = 50 + (x - z) * 40;
                const top = 18 + (x + z) * 34;
                const boxWidth = Math.max(30, (object.widthCm / widthCm) * 520);
                const boxDepth = Math.max(8, (object.depthCm / depthCm) * 210);
                const boxHeight = Math.max(10, (object.heightCm / heightCm) * 190);
                const firstProduct = object.products[0];
                return (
                  <button
                    type="button"
                    key={object.id}
                    className={`warehouse-3d-object type-${object.type.toLowerCase().replaceAll("_", "-")}${selectedId === object.id ? " is-selected" : ""}`}
                    style={{ left: `${left}%`, top: `${top}%`, width: `${boxWidth}px`, height: `${boxHeight}px`, zIndex: Math.round(top * 10) }}
                    onClick={() => setSelectedId(object.id)}
                  >
                    <span className="warehouse-3d-top" style={{ height: `${boxDepth}px` }} />
                    <span className="warehouse-3d-side" style={{ width: `${Math.max(6, boxDepth * 0.65)}px` }} />
                    <span className="warehouse-3d-front">
                      {firstProduct && <Image src={firstProduct.imageUrl} alt={firstProduct.name} width={34} height={34} />}
                      <strong>{object.label}</strong>
                      {object.products.length > 0 && <small>{object.products.length} producto(s)</small>}
                    </span>
                  </button>
                );
              })}
              {objects.length === 0 && <div className="warehouse-3d-empty">La bodega está vacía. Agrega objetos desde la vista Planta.</div>}
            </div>
          )}
        </div>

        <aside className="warehouse-inspector">
          <strong>Propiedades</strong>
          {!selected ? (
            <p>Selecciona un objeto para editar sus medidas y posición.</p>
          ) : (
            <div className="warehouse-inspector-form">
              <label>Nombre<input value={selected.label} maxLength={120} onChange={(event) => updateObject(selected.id, { label: event.target.value })} /></label>
              <label>Tipo<select value={selected.type} onChange={(event) => updateObject(selected.id, { type: event.target.value as ObjectType })}>{(Object.keys(typeLabels) as ObjectType[]).map((type) => <option value={type} key={type}>{typeLabels[type]}</option>)}</select></label>
              <div className="warehouse-inspector-grid">
                <label>X (m)<input type="number" min="0" step="0.1" value={meters(selected.xCm)} onChange={(event) => numericPatch("xCm", event.target.value)} /></label>
                <label>Y (m)<input type="number" min="0" step="0.1" value={meters(selected.zCm)} onChange={(event) => numericPatch("zCm", event.target.value)} /></label>
                <label>Ancho<input type="number" min="0.1" step="0.1" value={meters(selected.widthCm)} onChange={(event) => numericPatch("widthCm", event.target.value)} /></label>
                <label>Fondo<input type="number" min="0.1" step="0.1" value={meters(selected.depthCm)} onChange={(event) => numericPatch("depthCm", event.target.value)} /></label>
                <label>Alto<input type="number" min="0.05" step="0.1" value={meters(selected.heightCm)} onChange={(event) => numericPatch("heightCm", event.target.value)} /></label>
                <label>Rotación<select value={selected.rotation} onChange={(event) => updateObject(selected.id, { rotation: Number(event.target.value) })}><option value={0}>0°</option><option value={90}>90°</option><option value={180}>180°</option><option value={270}>270°</option></select></label>
              </div>

              <div className="warehouse-inspector-products">
                <span>Productos ubicados</span>
                {selected.products.length === 0 && <small>Sin productos asignados.</small>}
                {selected.products.map((product) => (
                  <div key={product.id}>
                    <Image src={product.imageUrl} alt={product.name} width={42} height={42} />
                    <span><strong>{product.name}</strong><small>{product.available} {unitLabel(product.unit)} disponibles{product.locationCode ? ` · ${product.locationCode}` : ""}</small></span>
                  </div>
                ))}
              </div>

              <button className="admin-button admin-button-danger" type="button" onClick={removeSelected}>Eliminar del plano</button>
              <small className="warehouse-safe-note">Eliminar un objeto del plano no elimina productos ni existencias. Solo quita su referencia visual al guardar.</small>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
