import "server-only";

import { DteEnvironment } from "@prisma/client";

export type SiiProvider = "mock" | "gateway";

export type SiiConfig = {
  enabled: boolean;
  environment: DteEnvironment;
  provider: SiiProvider;
  vatRate: number;
  autoIssueBoleta: boolean;
  company: {
    rut: string;
    rutSender: string;
    legalName: string;
    giro: string;
    activityCode: string;
    address: string;
    commune: string;
    city: string;
  };
  gateway: {
    submitUrl: string;
    statusUrl: string;
    token: string;
  };
  directCredentials: {
    certificatePfxBase64: string;
    certificatePassword: string;
    caf39Base64: string;
    caf33Base64: string;
    caf61Base64: string;
    caf56Base64: string;
    seedUrl: string;
    tokenUrl: string;
    uploadUrl: string;
    statusUrl: string;
  };
};

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function boolEnv(name: string, fallback = false): boolean {
  const value = env(name).toLowerCase();
  if (!value) return fallback;
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(env(name));
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function parseEnvironment(): DteEnvironment {
  switch (env("SII_ENV").toLowerCase()) {
    case "production": return DteEnvironment.PRODUCTION;
    case "certification": return DteEnvironment.CERTIFICATION;
    default: return DteEnvironment.MOCK;
  }
}

function parseProvider(): SiiProvider {
  return env("SII_PROVIDER").toLowerCase() === "gateway" ? "gateway" : "mock";
}

export function getSiiConfig(): SiiConfig {
  return {
    enabled: boolEnv("SII_ENABLED", false),
    environment: parseEnvironment(),
    provider: parseProvider(),
    vatRate: intEnv("SII_VAT_RATE", 19, 0, 100),
    autoIssueBoleta: boolEnv("SII_AUTO_ISSUE_BOLETA", false),
    company: {
      rut: env("SII_RUT_EMISOR"),
      rutSender: env("SII_RUT_ENVIA"),
      legalName: env("SII_RAZON_SOCIAL"),
      giro: env("SII_GIRO"),
      activityCode: env("SII_ACTECO"),
      address: env("SII_DIRECCION"),
      commune: env("SII_COMUNA"),
      city: env("SII_CIUDAD"),
    },
    gateway: {
      submitUrl: env("SII_GATEWAY_SUBMIT_URL"),
      statusUrl: env("SII_GATEWAY_STATUS_URL"),
      token: env("SII_GATEWAY_TOKEN"),
    },
    directCredentials: {
      certificatePfxBase64: env("SII_CERT_PFX_BASE64"),
      certificatePassword: env("SII_CERT_PASSWORD"),
      caf39Base64: env("SII_CAF_39_BASE64"),
      caf33Base64: env("SII_CAF_33_BASE64"),
      caf61Base64: env("SII_CAF_61_BASE64"),
      caf56Base64: env("SII_CAF_56_BASE64"),
      seedUrl: env("SII_SEED_URL"),
      tokenUrl: env("SII_TOKEN_URL"),
      uploadUrl: env("SII_DTE_UPLOAD_URL"),
      statusUrl: env("SII_DTE_STATUS_URL"),
    },
  };
}

export type SiiReadiness = {
  ready: boolean;
  enabled: boolean;
  environment: DteEnvironment;
  provider: SiiProvider;
  missing: string[];
  warnings: string[];
};

export function getSiiReadiness(config = getSiiConfig()): SiiReadiness {
  const missing: string[] = [];
  const warnings: string[] = [];
  const live = config.environment !== DteEnvironment.MOCK;

  if (live) {
    const requiredCompany: Array<[string, string]> = [
      ["SII_RUT_EMISOR", config.company.rut],
      ["SII_RUT_ENVIA", config.company.rutSender],
      ["SII_RAZON_SOCIAL", config.company.legalName],
      ["SII_GIRO", config.company.giro],
      ["SII_ACTECO", config.company.activityCode],
      ["SII_DIRECCION", config.company.address],
      ["SII_COMUNA", config.company.commune],
      ["SII_CIUDAD", config.company.city],
    ];
    for (const [name, value] of requiredCompany) if (!value) missing.push(name);

    if (config.provider === "gateway") {
      if (!config.gateway.submitUrl) missing.push("SII_GATEWAY_SUBMIT_URL");
      if (!config.gateway.statusUrl) missing.push("SII_GATEWAY_STATUS_URL");
      if (!config.gateway.token) missing.push("SII_GATEWAY_TOKEN");
    } else {
      warnings.push("El proveedor mock solo puede utilizarse con SII_ENV=mock.");
    }
  }

  if (!config.enabled) warnings.push("SII_ENABLED=false: no se realizarán envíos reales.");
  if (config.environment === DteEnvironment.MOCK) warnings.push("Ambiente MOCK: los estados SII son simulados para pruebas internas.");

  return {
    ready: missing.length === 0 && (!live || config.provider === "gateway") && (config.environment === DteEnvironment.MOCK || config.enabled),
    enabled: config.enabled,
    environment: config.environment,
    provider: config.provider,
    missing,
    warnings,
  };
}

export function assertSiiCanSubmit(config = getSiiConfig()): void {
  if (config.environment === DteEnvironment.MOCK) return;
  const readiness = getSiiReadiness(config);
  if (!config.enabled) throw new Error("La integración SII está deshabilitada. Configura SII_ENABLED=true después de completar certificación y credenciales.");
  if (!readiness.ready) throw new Error(`Configuración SII incompleta: ${readiness.missing.join(", ") || "proveedor no habilitado"}.`);
}
