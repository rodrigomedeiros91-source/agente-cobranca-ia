/**
 * A poupança do mês — o número que falta para corrigir a parcela.
 *
 * A conta do contrato é `fator = 1 + (taxa + poupança)/100`. A taxa está no
 * contrato; a poupança muda todo dia e é o Banco Central quem publica.
 *
 * DE ONDE VEM
 *
 * Série 195 do SGS do Banco Central: "Depósitos de poupança a partir de
 * 04.05.2012 — Rentabilidade no período". Ela é DIÁRIA, uma linha por
 * aniversário:
 *
 *   { "data": "15/08/2026", "dataFim": "15/09/2026", "valor": "0.6451" }
 *
 * `data` é quando o dinheiro entrou, `dataFim` é quando o rendimento é
 * creditado. **A parcela que vence dia 15/09 usa a linha com dataFim
 * 15/09** — não a com `data` 15/09. Errar esse lado é pegar o rendimento do
 * mês seguinte.
 *
 * Antes de 04/05/2012 vale a regra antiga, série 25. O piloto só olha para a
 * frente, mas a troca está aqui para o dia que alguém pedir um histórico.
 *
 * OS DIAS 29, 30 E 31 NÃO EXISTEM NA POUPANÇA
 *
 * A série simplesmente não tem esses dias — conferido pedindo 29 a 31 de
 * julho de 2026 ao Bacen, que respondeu vazio. A regra da poupança é que
 * quem faz aniversário em 29, 30 ou 31 recebe no dia 1º do mês seguinte.
 *
 * Isso não é detalhe: o Ed. Sigma 703 e o Ed. Ômega 103 vencem dia 30. Sem esta
 * regra, esses dois contratos ficariam sem índice para sempre. E confere com
 * o operador: para o vencimento de 30/08/2026 ele usou 0,6701, que é
 * exatamente o rendimento creditado em 01/09/2026.
 *
 * POR QUE ISTO VALE A PENA (conferido, não suposto)
 *
 * Peguei as 62 correções que o operador fez entre julho e setembro de 2026 e
 * comparei com a série oficial: **53 batem exatamente** (85%). As 9 que não
 * batem são erro de digitação dele, não da série:
 *
 *   06/07  ele 0,6797   oficial 0,6697   (trocou um 6 por um 7)
 *   20/07  ele 0,6607   oficial 0,6606   (último dígito)
 *   08/08  ele 0,6722   oficial 0,6741   (é o número de outro dia)
 *   08/09  ele 0,6734   oficial 0,6460   (é o número do dia 05)
 *   18/09  ele 0,6702   oficial 0,6717   (é o número do mês passado)
 *
 * Ou seja: o agente buscando o número oficial erra MENOS que a digitação à
 * mão. A diferença por parcela é de centavos, mas ela existe.
 *
 * O QUE ELE NUNCA FAZ
 *
 * Se o dia não está na série, devolve `null` com o motivo. Nunca pega o dia
 * mais próximo, nunca repete o mês passado, nunca chuta. Índice ausente
 * significa contrato fora da lista do dia, com aviso — não boleto com valor
 * inventado.
 */

/** A virada da regra da poupança: antes é série 25, a partir daí é a 195. */
const VIRADA = "2012-05-04";
const SGS = "https://api.bcb.gov.br/dados/serie/bcdata.sgs";

export function serieDoDia(dataISO) {
  return dataISO >= VIRADA ? 195 : 25;
}

const paraBR = (dataISO) => dataISO.split("-").reverse().join("/");
const paraISO = (dataBR) => dataBR.split("/").reverse().join("-");

export function url({ de, ate, serie = serieDoDia(de) }) {
  return (
    `${SGS}.${serie}/dados?formato=json` +
    `&dataInicial=${paraBR(de)}&dataFinal=${paraBR(ate)}`
  );
}

/**
 * Do JSON do Bacen para um mapa `data de crédito → poupança do período`.
 *
 * A chave é o `dataFim`. Quem vencer naquele dia usa aquele número.
 */
export function lerSerie(json) {
  const registros = typeof json === "string" ? JSON.parse(json) : json;
  const mapa = new Map();
  for (const registro of registros || []) {
    const fim = registro?.dataFim || registro?.datafim;
    const valor = Number(String(registro?.valor ?? "").replace(",", "."));
    if (fim && Number.isFinite(valor)) mapa.set(paraISO(fim), valor);
  }
  return mapa;
}

/**
 * O dia em que a poupança daquele vencimento é creditada.
 *
 * Vencimento em 29, 30 ou 31 recebe no dia 1º do mês seguinte, porque esses
 * dias não existem na poupança. Qualquer outro dia é ele mesmo.
 */
export function aniversario(dataISO) {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  if (dia < 29) return dataISO;
  const proximo = new Date(Date.UTC(ano, mes, 1)); // mes é 1-based aqui, então já é o seguinte
  return proximo.toISOString().slice(0, 10);
}

/** A janela do Bacen que cobre uma lista de vencimentos, com folga de um mês. */
function janela(datas) {
  const ordenadas = [...datas].sort();
  const mover = (iso, meses) => {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + meses);
    return d.toISOString().slice(0, 10);
  };
  return { de: mover(ordenadas[0], -2), ate: mover(ordenadas[ordenadas.length - 1], 1) };
}

async function buscarNoBacen(endereco) {
  const resposta = await fetch(endereco, { headers: { accept: "application/json" } });
  if (!resposta.ok) throw new Error(`Bacen respondeu ${resposta.status}`);
  return resposta.json();
}

/**
 * A poupança de vários vencimentos de uma vez.
 *
 * Uma chamada só ao Bacen cobre o mês inteiro: pedir dia a dia seria 33
 * requisições para gerar os boletos de um mês.
 *
 * @param {string[]} datas - vencimentos em AAAA-MM-DD
 * @param {object} opcoes
 * @param {Map<string, object>} opcoes.jaTemos - o que já está na aba `Indices`
 * @param {Function} opcoes.buscar - injetada no teste; em produção, o Bacen
 * @returns {Promise<Map<string, {poupanca, fonte, motivo}>>}
 */
export async function poupancaDosDias(datas = [], { jaTemos = new Map(), buscar = buscarNoBacen } = {}) {
  const pedidas = [...new Set(datas)].filter(Boolean);
  const resultado = new Map();
  if (!pedidas.length) return resultado;

  // O que já está na planilha vale: é cache e é também a correção manual do
  // operador, se um dia ele precisar sobrescrever um número.
  const faltando = [];
  for (const data of pedidas) {
    const guardado = jaTemos.get(data);
    if (guardado && Number.isFinite(Number(guardado.poupanca))) {
      resultado.set(data, { poupanca: Number(guardado.poupanca), fonte: guardado.fonte || "planilha" });
    } else {
      faltando.push(data);
    }
  }
  if (!faltando.length) return resultado;

  let serie;
  try {
    const { de, ate } = janela(faltando);
    serie = lerSerie(await buscar(url({ de, ate, serie: serieDoDia(de) })));
  } catch (erro) {
    for (const data of faltando) {
      resultado.set(data, { poupanca: null, motivo: `não deu para falar com o Banco Central: ${erro.message}` });
    }
    return resultado;
  }

  for (const data of faltando) {
    const dia = aniversario(data);
    const valor = serie.get(dia);
    resultado.set(
      data,
      Number.isFinite(valor)
        ? { poupanca: valor, fonte: "bacen", aniversario: dia, novo: true, obtidoEm: new Date().toISOString() }
        : {
            poupanca: null,
            motivo: `o Banco Central não publicou a poupança que fecha em ${paraBR(dia)}`,
          }
    );
  }
  return resultado;
}

/** Um dia só. Atalho para quem só precisa de um. */
export async function poupancaDoDia(data, opcoes) {
  return (await poupancaDosDias([data], opcoes)).get(data);
}

/**
 * O que vale a pena gravar na aba `Indices` para não perguntar de novo.
 *
 * Só o que ACABOU de vir do Bacen. O que já estava na planilha fica quieto,
 * senão cada rodada duplicaria a aba inteira.
 */
export function paraGravar(resultado) {
  return [...resultado.entries()]
    .filter(([, r]) => r.novo && Number.isFinite(r.poupanca))
    .map(([data, r]) => ({
      data,
      poupanca: r.poupanca,
      fonte: "bacen",
      obtido_em: r.obtidoEm || new Date().toISOString(),
    }));
}
