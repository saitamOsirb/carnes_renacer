"use client";

import { useState } from "react";
import { getCsrfToken } from "@/lib/client-security";
import { publicConfig } from "@/lib/public-config";

export function ContactSection() {
  const [status, setStatus] = useState("");
  async function submit(formData: FormData) {
    setStatus("Enviando…");
    const body = Object.fromEntries(formData.entries());
    const response = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrfToken() },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    setStatus(response.ok ? "Mensaje enviado. Te contactaremos pronto." : result.message ?? "No pudimos enviar el mensaje.");
  }

  return (
    <section className="contact-section">
      <div className="container contact-grid">
        <div><span className="eyebrow">Hablemos</span><h2>Estamos para ayudarte</h2><p>Resolvemos dudas, cotizaciones y coordinación de despacho.</p>
          <div className="contact-cards"><span>☎ {publicConfig.phone}</span><span>✉ {publicConfig.email}</span><span>⌖ {publicConfig.city}</span></div>
        </div>
        <form action={submit} className="contact-form">
          <div className="form-grid"><label>Nombre<input name="name" required minLength={3} maxLength={120} /></label><label>Empresa<input name="company" maxLength={120} /></label><label>Email<input name="email" type="email" required maxLength={160} /></label><label>Teléfono<input name="phone" maxLength={18} /></label></div>
          <label>Motivo<select name="subject" defaultValue="Cotización"><option>Cotización</option><option>Despacho</option><option>Productos</option><option>Otro</option></select></label>
          <label>Mensaje<textarea name="message" required minLength={10} maxLength={1000} rows={4} /></label>
          <button className="button button-primary" type="submit">Enviar mensaje</button>
          <p className="form-status" aria-live="polite">{status}</p>
        </form>
      </div>
    </section>
  );
}
