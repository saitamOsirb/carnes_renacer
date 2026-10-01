"use client";

export function PrintButton() {
  return <button type="button" className="admin-button admin-button-primary pos-print-button" onClick={() => window.print()}>Imprimir comprobante</button>;
}
