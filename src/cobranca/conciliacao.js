/**
 * A conferência: o relatório do banco contra as parcelas em aberto.
 *
 * Função pura. Entram os lançamentos lidos do relatório e as parcelas que a
 * planilha diz estarem abertas; sai o que fazer com cada um.
 *
 * A REGRA DE OURO
 *
 * "Baixado" NÃO é pagamento. Em 15/09/2026 o operador explicou o que é: **o Itaú
 * baixa o boleto sozinho depois de 60 dias sem pagamento.** A dívida continua
 * de pé; o que morreu foi o papel.
 *
 * Os três de agosto, com a resposta dele em cada um:
 *
 *   A801-03/05 (Paulo)    "está com as parcelas atrasadas" — dívida aberta
 *   P212-08/24 (Vinicius)  "prestação vencida em 05/07 em atraso" — aberta
 *   P211-10/38 (Bianca)    "pagou através de OUTRO boleto, porque este estava
 *                           com valor errado" — paga, fora deste código
 *
 * Então baixado quer dizer duas coisas opostas: quase sempre "ninguém pagou,
 * precisa de 2ª via", às vezes "pagou por outro boleto". As duas pedem olho
 * humano e nenhuma delas é baixa automática. Vira alerta, com as duas
 * hipóteses escritas, para o operador decidir em dois segundos.
 *
 * O caso do Vinicius mostra por que não pode virar pagamento: a parcela 08 foi
 * baixada e a 09 foi paga. Se baixa virasse pagamento, o agente pararia de
 * cobrar uma parcela que ninguém pagou.
 *
 * NADA É DECIDIDO EM SILÊNCIO
 *
 * Todo lançamento do relatório sai em exatamente uma das quatro listas. Se um
 * dia aparecer um caso que não se encaixa, ele cai em `alertas` e alguém olha —
 * nunca é descartado. O teste confere essa soma.
 */

import { normalizarSeuNumero } from "./relatorios.js";

/** Um centavo de diferença já é diferença. Acima disso, é dúvida. */
const TOLERANCIA = 0.005;

/**
 * @param {object[]} lancamentos - do relatório do banco (ver relatorios.js)
 * @param {object[]} parcelas - da planilha: { seuNumero, valor, status }
 */
export function conciliar({ lancamentos = [], parcelas = [] } = {}) {
  const porSeuNumero = new Map();
  for (const parcela of parcelas) {
    porSeuNumero.set(normalizarSeuNumero(parcela.seuNumero), parcela);
  }

  const baixas = [];
  const alertas = [];
  const duvidas = [];
  const ignorados = [];
  const jaVistos = new Set();

  for (const lancamento of lancamentos) {
    const seuNumero = normalizarSeuNumero(lancamento.seuNumero);
    const parcela = porSeuNumero.get(seuNumero);

    // O mesmo relatório mandado duas vezes, ou dois relatórios com período que
    // se sobrepõe. O Nosso Número é único por boleto, então serve de carimbo.
    if (lancamento.nossoNumero && jaVistos.has(lancamento.nossoNumero)) {
      ignorados.push({ seuNumero, motivo: "repetido-no-arquivo" });
      continue;
    }
    if (lancamento.nossoNumero) jaVistos.add(lancamento.nossoNumero);

    // Boleto que o banco tem e a planilha não. Acontece de verdade: o Ed. Épsilon
    // 103 tem dois boletos vencidos no nome do Sérgio, e a planilha mostra o
    // imóvel no nome do Márcio. O alerta leva a situação junto, porque um
    // boleto cancelado que nem está na planilha é outra conversa.
    if (!parcela) {
      alertas.push({
        seuNumero,
        tipo: "fora-da-planilha",
        situacao: lancamento.situacao,
        detalhe: `O banco tem este boleto (${lancamento.situacao}, R$ ${lancamento.valor}) e a planilha não.`,
      });
      continue;
    }

    if (lancamento.situacao === "baixado") {
      alertas.push({
        seuNumero,
        tipo: "baixado",
        situacao: lancamento.situacao,
        precisaDeSegundaVia: true,
        detalhe:
          `O Itaú baixou este boleto em ${lancamento.baixa}, o que quase sempre ` +
          `quer dizer 60 dias sem pagamento — a parcela continua em aberto e ` +
          `precisa de 2ª via. Confira antes se ela não foi paga por outro boleto.`,
      });
      continue;
    }

    if (parcela.status === "pago") {
      ignorados.push({ seuNumero, motivo: "ja-baixado" });
      continue;
    }

    // O banco cobra a PRESTAÇÃO + a tarifa de emissão. Conferir contra a
    // prestação acusaria os R$ 5,00 como divergência em todo boleto do mês —
    // 19 alertas falsos por mês, e num mar de alerta falso o alerta de verdade
    // some. `valorBoleto` é o número que o banco vê.
    const esperado = Number(parcela.valorBoleto ?? parcela.valor);
    if (Math.abs(esperado - Number(lancamento.valor)) > TOLERANCIA) {
      duvidas.push({
        seuNumero,
        tipo: "valor-diferente",
        esperado,
        recebido: Number(lancamento.valor),
      });
      continue;
    }

    baixas.push({
      seuNumero,
      pagoEm: lancamento.baixa,
      valorPago: Number(lancamento.valor),
    });
  }

  return { baixas, alertas, duvidas, ignorados };
}

/** Uma linha de resumo para a mensagem do operador. */
export function resumo({ baixas, alertas, duvidas, ignorados }) {
  const partes = [`${baixas.length} ${baixas.length === 1 ? "baixa" : "baixas"}`];
  if (duvidas.length) partes.push(`${duvidas.length} com dúvida`);
  if (alertas.length) partes.push(`${alertas.length} para olhar`);
  if (ignorados.length) partes.push(`${ignorados.length} já conferido`);
  return partes.join(", ");
}
