import Link from "next/link";
import { PosUserRole } from "@prisma/client";
import {
  createCashRegister,
  createPosUser,
  updateCashRegister,
  updatePosUser,
} from "@/app/admin/pos-management-actions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function PosConfigurationPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [users, registers, warehouses, query] = await Promise.all([
    prisma.posUser.findMany({
      include: { _count: { select: { shifts: true, sales: true } } },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    prisma.cashRegister.findMany({
      include: { warehouse: true, _count: { select: { shifts: true } } },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    prisma.warehouse.findMany({ where: { active: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    searchParams,
  ]);

  return (
    <div className="admin-content pos-admin-page">
      <div className="admin-title-row">
        <div>
          <span className="admin-kicker">POS</span>
          <h1>Usuarios y cajas</h1>
          <p>Administra cajeros, supervisores y cajas físicas vinculadas a cada bodega.</p>
        </div>
        <div className="pos-page-actions">
          <Link className="admin-button admin-button-secondary" href="/admin/pos">Ir al POS</Link>
          <Link className="admin-button admin-button-secondary" href="/admin/pos/reportes">Reportes</Link>
        </div>
      </div>

      {query.ok && <div className="admin-alert admin-alert-ok">{query.ok}</div>}
      {query.error && <div className="admin-alert admin-alert-error">{query.error}</div>}

      <section className="admin-operation-grid pos-maintainers-grid">
        <div className="admin-card">
          <div className="admin-card-heading"><div><h2>Nuevo usuario POS</h2><p>El PIN se guarda derivado con scrypt, nunca en texto plano.</p></div></div>
          <form action={createPosUser} className="admin-form">
            <label>Nombre<input name="name" required minLength={2} maxLength={191} placeholder="María González" /></label>
            <label>Usuario<input name="username" required minLength={3} maxLength={80} placeholder="maria.g" /></label>
            <label>Rol<select name="role" defaultValue="CASHIER"><option value="CASHIER">Cajero</option><option value="MANAGER">Supervisor</option></select></label>
            <label>PIN<input name="pin" type="password" inputMode="numeric" pattern="[0-9]{4,12}" required minLength={4} maxLength={12} autoComplete="new-password" /></label>
            <button className="admin-button admin-button-primary" type="submit">Crear usuario</button>
          </form>
        </div>

        <div className="admin-card">
          <div className="admin-card-heading"><div><h2>Nueva caja</h2><p>Cada caja vende contra el inventario de una bodega.</p></div></div>
          <form action={createCashRegister} className="admin-form">
            <label>Código<input name="code" required minLength={2} maxLength={40} placeholder="CAJA-2" /></label>
            <label>Nombre<input name="name" required minLength={2} maxLength={191} placeholder="Caja mostrador 2" /></label>
            <label>Bodega<select name="warehouseId" required defaultValue=""><option value="" disabled>Selecciona bodega</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label>
            <button className="admin-button admin-button-primary" type="submit">Crear caja</button>
          </form>
        </div>
      </section>

      <section className="admin-card pos-management-section">
        <div className="admin-card-heading"><div><h2>Usuarios POS</h2><p>Desactivar no elimina el historial. Deja el PIN vacío para conservarlo.</p></div></div>
        <div className="pos-maintainer-list">
          {users.length === 0 && <div className="pos-empty">No hay usuarios POS. Crea el primero para poder abrir una caja.</div>}
          {users.map((user) => (
            <form action={updatePosUser} className={`pos-maintainer-row${user.active ? "" : " is-inactive"}`} key={user.id}>
              <input type="hidden" name="id" value={user.id} />
              <label>Nombre<input name="name" required defaultValue={user.name} maxLength={191} /></label>
              <label>Usuario<input name="username" required defaultValue={user.username} maxLength={80} /></label>
              <label>Rol<select name="role" defaultValue={user.role}><option value={PosUserRole.CASHIER}>Cajero</option><option value={PosUserRole.MANAGER}>Supervisor</option></select></label>
              <label>Nuevo PIN<input name="pin" type="password" inputMode="numeric" pattern="[0-9]{4,12}" minLength={4} maxLength={12} placeholder="Sin cambios" autoComplete="new-password" /></label>
              <label className="pos-check"><input type="checkbox" name="active" defaultChecked={user.active} /> Activo</label>
              <div className="pos-maintainer-meta"><span>{user._count.shifts} turnos</span><span>{user._count.sales} ventas</span></div>
              <button className="admin-button admin-button-secondary" type="submit">Guardar</button>
            </form>
          ))}
        </div>
      </section>

      <section className="admin-card pos-management-section">
        <div className="admin-card-heading"><div><h2>Cajas registradoras</h2><p>Puedes tener varias cajas usando la misma bodega o bodegas distintas.</p></div></div>
        <div className="pos-maintainer-list">
          {registers.length === 0 && <div className="pos-empty">No hay cajas configuradas.</div>}
          {registers.map((register) => (
            <form action={updateCashRegister} className={`pos-maintainer-row pos-register-row${register.active ? "" : " is-inactive"}`} key={register.id}>
              <input type="hidden" name="id" value={register.id} />
              <label>Código<input name="code" required defaultValue={register.code} maxLength={40} /></label>
              <label>Nombre<input name="name" required defaultValue={register.name} maxLength={191} /></label>
              <label>Bodega<select name="warehouseId" defaultValue={register.warehouseId}>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label>
              <label className="pos-check"><input type="checkbox" name="active" defaultChecked={register.active} /> Activa</label>
              <div className="pos-maintainer-meta"><span>{register._count.shifts} turnos históricos</span><span>{register.warehouse.name}</span></div>
              <button className="admin-button admin-button-secondary" type="submit">Guardar</button>
            </form>
          ))}
        </div>
      </section>
    </div>
  );
}
