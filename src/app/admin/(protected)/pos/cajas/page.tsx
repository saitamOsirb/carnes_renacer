import Link from "next/link";
import { PosShiftStatus } from "@prisma/client";
import { createCashRegister, updateCashRegister } from "@/app/admin/pos-management-actions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function CashRegistersPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [registers, warehouses, query] = await Promise.all([
    prisma.cashRegister.findMany({
      include: {
        warehouse: true,
        shifts: {
          where: { status: PosShiftStatus.OPEN },
          include: { user: true },
          take: 1,
        },
        _count: { select: { shifts: true } },
      },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    prisma.warehouse.findMany({ where: { active: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    searchParams,
  ]);

  const activeCount = registers.filter((register) => register.active).length;
  const openCount = registers.filter((register) => register.shifts.length > 0).length;
  const warehouseCount = new Set(registers.map((register) => register.warehouseId)).size;

  return (
    <div className="admin-content pos-admin-page">
      <div className="admin-title-row">
        <div>
          <span className="admin-kicker">POS</span>
          <h1>Mantenedor de cajas</h1>
          <p>Crea y administra múltiples cajas físicas, incluso varias cajas contra una misma bodega.</p>
        </div>
        <div className="pos-page-actions">
          <Link className="admin-button admin-button-secondary" href="/admin/pos">Ir al POS</Link>
          <Link className="admin-button admin-button-secondary" href="/admin/pos/configuracion">Usuarios POS</Link>
          <Link className="admin-button admin-button-secondary" href="/admin/pos/reportes">Reportes</Link>
        </div>
      </div>

      {query.ok && <div className="admin-alert admin-alert-ok">{query.ok}</div>}
      {query.error && <div className="admin-alert admin-alert-error">{query.error}</div>}

      <section className="admin-stats-grid">
        <div className="admin-stat"><strong>{registers.length}</strong><span>cajas totales</span></div>
        <div className="admin-stat"><strong>{activeCount}</strong><span>cajas activas</span></div>
        <div className="admin-stat"><strong>{openCount}</strong><span>cajas abiertas</span></div>
        <div className="admin-stat"><strong>{warehouseCount}</strong><span>bodegas utilizadas</span></div>
      </section>

      <section className="admin-card admin-create-card">
        <div className="admin-card-heading"><div><h2>Nueva caja</h2><p>El código debe ser único. Puedes crear tantas cajas como necesites.</p></div></div>
        {warehouses.length === 0 ? (
          <div className="admin-inline-notice">No hay bodegas activas. Crea o activa una bodega desde Inventario antes de crear cajas.</div>
        ) : (
          <form action={createCashRegister} className="admin-form admin-grid admin-grid-3">
            <label>Código<input name="code" required minLength={2} maxLength={40} placeholder="CAJA-2" /></label>
            <label>Nombre<input name="name" required minLength={2} maxLength={191} placeholder="Caja mostrador 2" /></label>
            <label>Bodega<select name="warehouseId" required defaultValue=""><option value="" disabled>Selecciona bodega</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label>
            <button className="admin-button admin-button-primary" type="submit">Crear caja</button>
          </form>
        )}
      </section>

      <section className="admin-card pos-management-section">
        <div className="admin-card-heading"><div><h2>Cajas registradas</h2><p>Una caja con turno abierto no puede desactivarse ni cambiar de bodega hasta cerrar el turno.</p></div></div>
        <div className="pos-maintainer-list">
          {registers.length === 0 && <div className="pos-empty">No hay cajas configuradas.</div>}
          {registers.map((register) => {
            const openShift = register.shifts[0];
            return (
              <form action={updateCashRegister} className={`pos-maintainer-row pos-register-row${register.active ? "" : " is-inactive"}`} key={register.id}>
                <input type="hidden" name="id" value={register.id} />
                <label>Código<input name="code" required defaultValue={register.code} maxLength={40} /></label>
                <label>Nombre<input name="name" required defaultValue={register.name} maxLength={191} /></label>
                <label>Bodega<select name="warehouseId" defaultValue={register.warehouseId}>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label>
                <label className="pos-check"><input type="checkbox" name="active" defaultChecked={register.active} /> Activa</label>
                <div className="pos-maintainer-meta">
                  <span>{register._count.shifts} turnos históricos</span>
                  <span>{register.warehouse.name}</span>
                  {openShift && <span>EN USO · {openShift.user.name}</span>}
                </div>
                <button className="admin-button admin-button-secondary" type="submit">Guardar caja</button>
              </form>
            );
          })}
        </div>
      </section>
    </div>
  );
}
