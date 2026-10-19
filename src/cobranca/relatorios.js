/**
 * Leitura dos dois relatórios de boleto do app do Itaú.
 *
 * É por aqui que o agente descobre quem pagou — e é a única fonte que vale.
 * Palavra de cliente e comprovante não dão baixa; o relatório dá.
 *
 * O QUE ENTRA E O QUE NÃO ENTRA
 *
 * Estas funções recebem TEXTO, já extraído do arquivo, e devolvem lista de
 * lançamentos. Elas não abrem PDF, não acessam rede e não guardam nada. Duas
 * razões: primeiro, assim dá para testar com o relatório de verdade, sem
 * depender de biblioteca nenhuma; segundo, o formato do arquivo que o operador
 * consegue exportar ainda pode mudar (o app do Itaú fala em "planilhas", e ele
 * mandou PDF) — trocar o adaptador de entrada é barato, trocar o leitor não.
 *
 * O CABEÇALHO NUNCA É LIDO
 *
 * O relatório traz agência, conta e CNPJ da empresa no topo. Nada disso entra
 * no resultado, nem em log: o leitor só olha as linhas de lançamento. A regra
 * do dono é que o agente não veja dado bancário da empresa, e é mais fácil
 * cumprir isso não lendo do que lembrando de apagar.
 */

/** "3.628,98" -> 3628.98 */
function valorBR(texto) {
  return Number(String(texto).replace(/\./g, "").replace(",", "."));
}

/** "30/07/2026" -> "2026-07-30" (ordenável, e sem fuso para atrapalhar) */
function dataBR(texto) {
  const [dia, mes, ano] = String(texto).split("/");
  return `${ano}-${mes}-${dia}`;
}

/** Tira espaço repetido e deixa o código do boleto num formato só. */
export function normalizarSeuNumero(texto) {
  return String(texto || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .trim();
}

/**
 * O limite do Itaú: o "Seu Número" tem no máximo 10 caracteres.
 *
 * Isso não é curiosidade — é a razão de o mesmo contrato ter dois códigos. O
 * operador explicou em 15/09/2026:
 *
 *   "O sistema de cobrança do Banco Itaú só aceita 10 caracteres para
 *    identificação... adotamos colocar uma letra na frente do número para
 *    identificar o imóvel... no caso do Ed. Delta 703 excepcionalmente foi
 *    feito em 100 vezes, por essa razão a nomenclatura teve que
 *    obrigatoriamente excluir um caractere; neste caso foi excluída a letra."
 *
 * Por isso o Rafael tem `703-01/100` na mensal (11 caracteres com o C, não
 * cabe) e `C703-01/02` nas intermediárias (10, cabe).
 *
 * O corte NÃO é mecânico: o Ed. Alfa 1003 virou `A003`, ou seja, ali cortaram um
 * dígito e mantiveram a letra. Quem decide o código é o operador, contrato por
 * contrato — por isso ele vive na planilha, na coluna `codigo` da série, e o
 * código aqui só monta e confere.
 */
export const LIMITE_ITAU = 10;

/**
 * `{ codigo: "A801", parcela: 4, total: 5 }` -> `"A801-04/05"`
 *
 * Parcela e total vão com pelo menos dois dígitos, que é como estão nos
 * boletos de verdade (`A801-04/05`, `C703-01/02`). O total de três dígitos
 * passa inteiro: `703-01/100`.
 */
export function montarSeuNumero({ codigo, parcela, total }) {
  const numero = String(parcela ?? "").padStart(2, "0");
  const fim = String(total ?? "").padStart(2, "0");
  return `${normalizarSeuNumero(codigo)}-${numero}/${fim}`;
}

/**
 * Por que não cabe, quando não cabe. Devolve `null` quando está tudo certo.
 *
 * ponytail: a parcela 100 de 100 (`703-100/100`) estoura em 11 caracteres. Só
 * acontece daqui a uns oito anos, e quando acontecer este aviso aparece na
 * lista do operador em vez de gerar um boleto que o banco recusa.
 */
export function problemaNoSeuNumero(seuNumero) {
  const codigo = normalizarSeuNumero(seuNumero);
  if (!codigo) return "o boleto ficou sem código";
  if (codigo.length > LIMITE_ITAU) {
    return `"${codigo}" tem ${codigo.length} caracteres e o Itaú só aceita ${LIMITE_ITAU}`;
  }
  return null;
}

const LIQUIDADO = new RegExp(
  [
    "^\\s*(?<pagador>.+?)\\s{2,}",
    "(?<vencimento>\\d{2}/\\d{2}/\\d{4})\\s+",
    "(?<baixa>\\d{2}/\\d{2}/\\d{4})\\s+",
    "(?<valor>[\\d.,]+)\\s+",
    "(?<carteira>\\d+)\\s+",
    "(?<nossoNumero>\\d+)\\s+",
    "(?<seuNumero>[A-Z0-9\\-/]+)\\s+",
    "(?<situacao>Liquidado|Baixado)",
  ].join("")
);

/**
 * Relatório "boletos baixados e liquidados".
 *
 * Uma linha por boleto, e a coluna `Histórico` diz o que aconteceu:
 * `Liquidado` é pagamento; `Baixado` é boleto cancelado — nunca pagamento.
 */
export function lerLiquidados(texto) {
  const lancamentos = [];
  for (const linha of String(texto || "").split("\n")) {
    const achado = LIQUIDADO.exec(linha);
    if (!achado) continue;
    const g = achado.groups;
    lancamentos.push({
      pagador: g.pagador.trim(),
      vencimento: dataBR(g.vencimento),
      baixa: dataBR(g.baixa),
      valor: valorBR(g.valor),
      nossoNumero: g.nossoNumero,
      seuNumero: normalizarSeuNumero(g.seuNumero),
      situacao: g.situacao.toLowerCase(),
    });
  }
  return lancamentos;
}

// No relatório de boletos em aberto, uma linha de dado não tem o código do
// boleto: ele fica partido em duas linhas vizinhas, uma com o prefixo do
// imóvel ("A801-") e outra com a parcela ("04/05"). O pagador também quebra em
// duas ou três linhas. Por isso este leitor trabalha com a vizinhança da linha,
// e não com a linha sozinha.
const EM_ABERTO = new RegExp(
  [
    "^\\s*(?<pagador>.*?)\\s*",
    "(?<vencimento>\\d{2}/\\d{2}/\\d{4})\\s+",
    "(?<valor>[\\d.,]+)\\s+",
    "(?<carteira>\\d{3})\\s+",
    "(?<nossoNumero>\\d{6,})\\s*",
    "(?<observacao>[A-ZÇÃÕÉ]*)\\s*",
    "(?<dda>SIM|NÃO|NAO)?\\s*$",
  ].join("")
);

const PREFIXO = /^\s*([A-Z]{0,2}\d{2,4})-\s*$/;
const PARCELA = /^\s*(\d{1,3}\/\d{1,3})\s*$/;

/** Junta as duas metades do código do boleto, olhando as linhas em volta. */
function seuNumeroPorPerto(linhas, indice) {
  let prefixo = null;
  let parcela = null;
  for (let i = indice - 3; i <= indice + 3; i++) {
    if (i < 0 || i >= linhas.length || i === indice) continue;
    const pedaco = linhas[i].slice(60); // o código fica na direita da página
    const p = PREFIXO.exec(pedaco);
    if (p && prefixo === null && i < indice) prefixo = p[1];
    const q = PARCELA.exec(pedaco);
    if (q && parcela === null && i > indice) parcela = q[1];
  }
  return prefixo && parcela ? normalizarSeuNumero(`${prefixo}-${parcela}`) : null;
}

/**
 * Relatório "boletos em aberto (a vencer e vencidos)".
 *
 * Serve para conferir se o que o operador gerou no banco é o que o agente
 * calculou, e para achar boleto que existe no banco e não existe na planilha.
 */
export function lerEmAberto(texto) {
  const linhas = String(texto || "").split("\n");
  const boletos = [];
  linhas.forEach((linha, indice) => {
    const achado = EM_ABERTO.exec(linha);
    if (!achado) return;
    const g = achado.groups;
    boletos.push({
      // O nome do pagador quebra em duas ou três linhas neste relatório, e
      // juntar pedaço de linha vizinha trazia nome de OUTRO boleto junto.
      // Nome errado é pior do que nome nenhum: quem identifica o boleto é o
      // Seu Número, e o nome do cliente está na planilha.
      pagador: g.pagador.trim(),
      vencimento: dataBR(g.vencimento),
      valor: valorBR(g.valor),
      nossoNumero: g.nossoNumero,
      seuNumero: seuNumeroPorPerto(linhas, indice),
      vencido: g.observacao === "VENCIDO",
    });
  });
  return boletos;
}
