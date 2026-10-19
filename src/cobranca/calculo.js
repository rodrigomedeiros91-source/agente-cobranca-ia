/**
 * A conta do agente de cobrança.
 *
 * Função pura: sem rede, sem planilha, sem WhatsApp. Dá para rodar dezessete
 * mil vezes em segundos — é o que o teste faz — e não existe caminho daqui até
 * uma mensagem saindo para um cliente.
 *
 * A REGRA, LIDA DAS CÉLULAS DA PLANILHA DO OPERADOR (aba `tabela`)
 *
 *   E = ((taxa_do_contrato + poupanca_do_mes)/100 + 1)
 *   F = C * E        C é o valor do mês anterior, com todas as casas
 *
 * Cada série do contrato — a prestação mensal e cada intermediária — é
 * corrigida pelo mesmo fator, todo mês, até vencer. A intermediária que só
 * vence daqui a três anos também é corrigida todo mês; é por isso que ela
 * aparece numa coluna própria, sendo multiplicada mês após mês.
 *
 * POR QUE NÃO ARREDONDAR NO MEIO
 *
 * A planilha guarda o valor com todas as casas e só o boleto sai com centavos.
 * Arredondar a cada mês parece inofensivo e, em 100 parcelas, muda o valor
 * final — e um centavo de diferença na cobrança é o que faz o cliente
 * desconfiar de tudo o que veio antes.
 */

/** O fator do mês. É a célula E da planilha, escrita em JavaScript. */
export function fator({ taxa = 0, poupanca = 0 } = {}) {
  return (Number(taxa) + Number(poupanca)) / 100 + 1;
}

/**
 * Duas casas, meio para cima — do jeito que o Excel mostra, que é o número que
 * o operador digita no banco.
 *
 * O caminho pela string existe por causa de dois casos reais do histórico:
 * 2.527,055 e 5.050,125. Em binário eles viram 2527.05499999... e
 * 5050.12500000...1, então `Math.round(v * 100)` devolve um centavo a menos num
 * e a mais no outro. Convertendo para decimal antes, os dois arredondam como na
 * planilha. Dezessete mil casos passam; sem isso, dois falham.
 */
export function arredondar(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return NaN;
  return Number(`${Math.round(Number(`${numero}e+2`))}e-2`);
}

/**
 * O mesmo número que a planilha guardaria.
 *
 * O Excel arredonda todo resultado para 15 dígitos significativos antes de
 * guardar. Parece detalhe e não é: 5025 × 1,005 dá 5050,124999999999 em
 * JavaScript e 5050,125 na planilha, e aí o boleto sai com um centavo a menos
 * do que o operador cobrou. Aconteceu exatamente uma vez em 17.384 meses de
 * histórico — e uma vez basta para o cliente ligar perguntando.
 */
function comoNoExcel(valor) {
  return Number(Number(valor).toPrecision(15));
}

function moeda(valor) {
  return Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function porcento(valor) {
  return `${String(valor).replace(".", ",")}%`;
}

/**
 * A multiplicação em si, quando o fator já vem pronto.
 *
 * Existe separada porque é o único lugar do projeto que multiplica dinheiro —
 * e porque parte do histórico do operador tem o fator digitado direto na célula,
 * sem a fórmula de taxa + poupança. Os dois caminhos passam por aqui, então a
 * regra do Excel vale para os dois.
 */
export function aplicarFator({ valorAtual, fator: f }) {
  const valorCheio = comoNoExcel(Number(valorAtual) * Number(f));
  return { valorCheio, valor: arredondar(valorCheio) };
}

/**
 * A taxa que vale no mês deste vencimento.
 *
 * Alguns contratos mudam de taxa no meio do caminho. O Paulo (Ed. Alfa 801) é o
 * caso, e é ele que mostra por que a virada tem que ser por DATA e não por
 * número de parcela. Na planilha do operador está escrito "após 24ª poup +
 * 0,7%". O contrato dele diz outra coisa:
 *
 *   "até o mês de setembro de 2026 será reajustado mensalmente pelo índice da
 *    poupança acrescida de 0,5%, e a partir de outubro de 2026, será
 *    reajustado mensalmente pelo índice da poupança acrescida de 0,7%"
 *
 * O operador confirmou em 15/09/2026: a anotação da planilha está errada, a
 * parcela certa seria a 19, e o que manda é **outubro de 2026**.
 *
 * Contar parcela seria frágil de qualquer jeito. Basta um adiamento para o
 * número da parcela e o mês desencontrarem, e a taxa viraria no mês errado —
 * sem ninguém perceber, porque a diferença é de centavos por mês, que depois
 * compõem por anos.
 *
 * @param {object} contrato - com `taxa` e, opcionalmente, `taxaApos: {desde, taxa}`
 * @param {string} vencimento - AAAA-MM-DD
 */
export function taxaDoContrato(contrato = {}, vencimento = "") {
  const troca = contrato.taxaApos;
  if (troca?.desde && String(vencimento).slice(0, 7) >= troca.desde) return Number(troca.taxa);
  return Number(contrato.taxa ?? 0);
}

/**
 * Corrige uma parcela.
 *
 * Devolve três coisas: o valor cheio (que alimenta o mês seguinte, com todas as
 * casas), o valor do boleto (com centavos) e a memória de cálculo — a conta
 * aberta, que vai junto na lista do operador. Ele confere a conta, não só o
 * resultado.
 */
export function corrigir({ valorAtual, taxa = 0, poupanca = 0, regra = "poupanca+taxa" }) {
  const base = Number(valorAtual);
  if (!Number.isFinite(base)) throw new Error("valorAtual precisa ser número");

  if (regra === "fixo") {
    return {
      valorCheio: base,
      valor: arredondar(base),
      memoria: `Contrato de valor fixo: ${moeda(base)}, sem correção.`,
    };
  }

  const f = fator({ taxa, poupanca });
  const { valorCheio } = aplicarFator({ valorAtual: base, fator: f });

  return {
    valorCheio,
    valor: arredondar(valorCheio),
    memoria: [
      `Valor do mês anterior: ${moeda(base)}`,
      `Poupança do mês: ${porcento(poupanca)}`,
      `Taxa do contrato: ${porcento(taxa)}`,
      `Fator: ${f.toFixed(6).replace(".", ",")}`,
      `Valor desta parcela: ${moeda(arredondar(valorCheio))}`,
    ].join("\n"),
  };
}

/**
 * A TARIFA DO BOLETO, E POR QUE ELA MORA FORA DA CORREÇÃO
 *
 * O Itaú cobra R$ 5,00 para emitir cada boleto, e esse valor entra no boleto.
 * Foi assim que a diferença apareceu: o banco cobrava R$ 4.150,33 onde a
 * planilha do operador dizia R$ 4.145,33, em nove contratos, sempre os mesmos
 * R$ 5,00 — inclusive no Ed. Beta 303, que naquele mês não teve correção
 * nenhuma e mostrou a diferença limpa.
 *
 * O CUIDADO QUE FAZ ESTE ARQUIVO EXISTIR
 *
 * A tarifa NÃO pode entrar no valor que corrige o mês seguinte. Se entrasse,
 * ela seria corrigida junto com a prestação, todo mês, para sempre — e como o
 * fator compõe, os R$ 5,00 de hoje virariam R$ 5,04 no mês que vem, R$ 5,08 no
 * outro, e ao longo de um contrato de 100 parcelas o cliente pagaria juros
 * sobre uma tarifa bancária. Ninguém perceberia por anos: a diferença mensal é
 * de centavos.
 *
 * Por isso são dois números, e eles nunca se misturam:
 *
 *   prestação   o que amortiza o contrato. É ela que corrige no mês seguinte,
 *               é ela que vai para a coluna `valor_corrente` da planilha, e é
 *               dela que o controle financeiro da Imobiliária Exemplo fala.
 *   boleto      prestação + tarifa. É o que o cliente paga e o que aparece no
 *               relatório do banco. Serve para conferir o pagamento e mais nada.
 *
 * A tarifa é despesa da Imobiliária Exemplo repassada no boleto: ela entra e sai, e nunca
 * encosta no saldo do contrato.
 */
export const TARIFA_BOLETO = 5;

/** Prestação corrigida -> valor que vai no boleto. */
export function valorDoBoleto(prestacao, tarifa = TARIFA_BOLETO) {
  return arredondar(Number(prestacao) + Number(tarifa));
}

/** A conta aberta, para o operador conferir o boleto antes de emitir. */
export function memoriaDoBoleto({ prestacao, tarifa = TARIFA_BOLETO }) {
  return [
    `Prestação corrigida: ${moeda(prestacao)}`,
    `Tarifa de emissão do boleto: ${moeda(tarifa)}`,
    `Valor do boleto: ${moeda(valorDoBoleto(prestacao, tarifa))}`,
    `(a tarifa não entra na correção do mês seguinte)`,
  ].join("\n");
}
