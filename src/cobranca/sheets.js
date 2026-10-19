import { google } from "googleapis";

/**
 * Cliente do Google Sheets da cobrança. A planilha é onde o operador trabalha:
 * contratos, séries de parcelas, índices e a lista do que emitir no banco.
 *
 * Exige o escopo https://www.googleapis.com/auth/spreadsheets no refresh token.
 */
const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

// `let` e não `const` de propósito: ver useFakeSheetsClient() abaixo.
let sheets = google.sheets({ version: "v4", auth: oauth2Client });

export { sheets as sheetsClient };

/**
 * Troca o cliente do Google por um dublê. SÓ para teste. Funciona porque
 * `sheets` é exportado como ligação viva do ESM: quem importou `sheetsClient`
 * enxerga o novo valor na hora.
 */
export function useFakeSheetsClient(fake) {
  sheets = fake;
}
