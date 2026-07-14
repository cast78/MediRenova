// Texto legal de consentimiento RGPD. La clínica (tenant) es el responsable del
// tratamiento y se inserta con la variable {empresa}; Trencadis Business Solutions SL
// figura como encargado del tratamiento (proveedor del software).

export const DEFAULT_CONSENT_TEXT =
  "En cumplimiento del Reglamento (UE) 2016/679 (RGPD), le informamos que sus datos personales serán tratados por {empresa} con la finalidad de gestionar su historial médico-laboral y los servicios contratados, y gestionados por Trencadis Business Solutions SL como encargado del tratamiento. Puede ejercer sus derechos de acceso, rectificación, supresión y portabilidad dirigiéndose al responsable del tratamiento.";

// Sustituye {empresa} por el nombre de la clínica para mostrar/imprimir el texto.
export function renderConsent(text: string, empresa: string | null | undefined): string {
  return text.replace(/\{\s*empresa\s*\}/g, empresa || "el centro");
}
