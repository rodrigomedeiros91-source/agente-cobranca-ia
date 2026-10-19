/**
 * A planilha de trabalho do agente de cobrança ("Cobrança — Imobiliária Exemplo").
 *
 * Abas que o operador preenche: `Contratos`, `Series`.
 * Abas que o agente escreve: `Parcelas`, `BoletosAGerar`, `Historico`, `Indices`.
 *
 * TUDO É LIDO PELO NOME DA COLUNA, NUNCA PELA POSIÇÃO
 *
 * Quem abre a planilha é gente: o operador vai arrastar coluna, esconder
 * coluna, largar uma anotação no fim. Se o código contasse casas, o dia em
 * que ele mexesse na planilha o agente mandaria o valor do vizinho para o
 * cliente. Lendo pelo nome, mexer na ordem não quebra nada e coluna extra
 * (`de onde veio`, `conferir`) é simplesmente ignorada.
 *
 * O LEITOR NÃO ADIVINHA
 *
 * Célula vazia sai vazia. `periodicidade` em branco continua em branco, e
 * quem for montar a régua é que decide o que fazer com isso — de preferência,
 * avisar o operador. Chutar "deve ser anual" aqui viraria boleto na data
 * errada, e ninguém saberia de onde veio o chute.
 *
 * NÚMERO COM TODAS AS CASAS
 *
 * A leitura pede `UNFORMATTED_VALUE`: o Google devolve 2029.478, e não
 * "2029,48" como aparece na tela. A precisão cheia é o que faz a calculadora
 * bater centavo por centavo com a planilha do operador mês após mês.
 */

import { sheetsClient } from "./sheets.js";

const planilha = () => process.env.COBRANCA_SHEET_ID;

/** Cabeçalho por aba. Não muda no meio da vida do processo. */
const cabecalhos = new Map();

/**
 * Lê uma aba inteira e devolve um objeto por linha, com as chaves do
 * cabeçalho. `_linha` é o número da linha na planilha, que é o que permite
 * atualizar uma parcela no lugar de anexar outra igual.
 */
async function lerAba(aba) {
  const resposta = await sheetsClient.spreadsheets.values.get({
    spreadsheetId: planilha(),
    range: `${aba}!A:Z`,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  const [cabecalho = [], ...resto] = resposta.data.values || [];
  const chaves = cabecalho.map((c) => String(c ?? "").trim());
  if (chaves.length) cabecalhos.set(aba, chaves);

  return resto.map((linha, i) => {
    const registro = { _linha: i + 2 };
    chaves.forEach((chave, coluna) => {
      if (chave) registro[chave] = linha[coluna] ?? "";
    });
    return registro;
  });
}

/** Só o cabeçalho, para escrever na ordem certa sem baixar a aba inteira. */
async function chavesDa(aba) {
  if (!cabecalhos.has(aba)) {
    const resposta = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: planilha(),
      range: `${aba}!1:1`,
    });
    cabecalhos.set(aba, (resposta.data.values?.[0] || []).map((c) => String(c ?? "").trim()));
  }
  return cabecalhos.get(aba);
}

const texto = (valor) => String(valor ?? "").trim();

/**
 * "0,8" → 0.8 e "1.234,56" → 1234.56. Número já numérico passa direto, que é
 * o caso normal com UNFORMATTED_VALUE. Vazio ou palavra ("pago até dez 26",
 * que existe de verdade na planilha do operador) vira `null`, nunca zero: zero
 * seria um valor, e valor errado vira boleto errado.
 */
export function numero(valor) {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  const bruto = texto(valor);
  if (!bruto) return null;
  // O ponto só é separador de milhar quando existe vírgula depois dele.
  const limpo = bruto.includes(",") ? bruto.replace(/\./g, "").replace(",", ".") : bruto;
  const convertido = Number(limpo);
  return Number.isFinite(convertido) ? convertido : null;
}

/** "15/07/2026" → "2026-07-15". O formato que ordena e que o resto já usa. */
export function data(valor) {
  const bruto = texto(valor);
  const brasileira = bruto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (brasileira) {
    const [, dia, mes, ano] = brasileira;
    return `${ano}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
  }
  return /^\d{4}-\d{2}-\d{2}/.test(bruto) ? bruto.slice(0, 10) : "";
}

/**
 * "2026-10:0,7" → { desde: "2026-10", taxa: 0.7 }.
 *
 * É o caso do Paulo (Ed. Alfa 801): poupança + 0,5% até setembro de 2026,
 * poupança + 0,7% a partir de outubro. A virada é por MÊS, que é como o
 * contrato está escrito — ver `taxaDoContrato` em calculo.js.
 *
 * Qualquer outro formato devolve `null`, e quem chama guarda o texto cru em
 * `taxaAposBruto` para virar aviso. Engolir em silêncio significaria o
 * contrato nunca trocar de taxa, e ninguém descobriria tão cedo.
 */
export function trocaDeTaxa(valor) {
  const bruto = texto(valor);
  const achado = bruto.match(/^(\d{4}-\d{2})\s*:\s*(.+)$/);
  if (!achado) return null;
  const taxaNova = numero(achado[2]);
  return taxaNova === null ? null : { desde: achado[1], taxa: taxaNova };
}

/**
 * Os contratos que o agente pode cobrar. `pausado`, `fora` (jurídico, acordo,
 * quitado, aluguel) e qualquer coisa que não seja `ativo` ficam de fora — a
 * decisão de não cobrar alguém nunca depende de o agente lembrar de filtrar.
 */
export async function lerContratos() {
  const linhas = await lerAba("Contratos");

  return linhas
    .filter((linha) => texto(linha.situacao).toLowerCase() === "ativo")
    .map((linha) => {
      const codigo = texto(linha.codigo);
      const nome = texto(linha.nome);
      return {
        codigo,
        nome,
        // A chave que liga este contrato às suas séries. Enquanto o operador não
        // passar os códigos dos boletos, quem casa é o nome.
        chave: codigo || nome,
        telefone: texto(linha.telefone),
        imovel: texto(linha.imovel),
        diaVencimento: numero(linha.dia_vencimento),
        regra: texto(linha.regra) || "poupanca+taxa",
        taxa: numero(linha.taxa) ?? 0,
        taxaApos: trocaDeTaxa(linha.taxa_apos),
        // O texto cru, para quem quiser avisar que tem coisa escrita ali que o
        // agente não entendeu. Sem isso, um `taxa_apos` mal digitado viraria
        // "esse contrato nunca troca de taxa", em silêncio.
        taxaAposBruto: texto(linha.taxa_apos),
        situacao: "ativo",
        observacao: texto(linha.observacao),
      };
    });
}

/**
 * As séries de um contrato: a mensal e as intermediárias. Todas são corrigidas
 * pelo mesmo fator todo mês, inclusive as que só vencem daqui a anos.
 *
 * O `codigo` fica na SÉRIE, não só no contrato, porque o mesmo contrato pode
 * ter dois códigos de boleto. O Rafael (Ed. Delta 703) é o caso: a mensal tem
 * 100 parcelas e só cabe como `703-01/100`, enquanto as intermediárias, com 2
 * parcelas, cabem como `C703-01/02`. Quando a série não traz código, vale o do
 * contrato — que é o normal nos outros 20.
 */
export async function lerSeries(chave, { codigoDoContrato = "" } = {}) {
  const alvo = texto(chave).toUpperCase();
  if (!alvo) return [];

  const linhas = await lerAba("Series");

  return linhas
    .filter((linha) => texto(linha.contrato).toUpperCase() === alvo)
    .map((linha) => ({
      contrato: texto(linha.contrato),
      codigo: texto(linha.codigo) || texto(codigoDoContrato),
      serie: texto(linha.serie) || "mensal",
      total: numero(linha.total),
      parcelaAtual: numero(linha.parcela_atual),
      valorCorrente: numero(linha.valor_corrente),
      vencimentoAtual: data(linha.vencimento_atual),
      periodicidade: texto(linha.periodicidade),
      conferir: texto(linha.conferir),
    }));
}

/**
 * A poupança já guardada, pronta para entrar em `poupancaDosDias` como
 * `jaTemos`. Serve de cache e, quando o operador digita um número na mão, de
 * correção: o que está na planilha vence o que vem do Bacen.
 */
export async function lerIndices() {
  const linhas = await lerAba("Indices");
  const mapa = new Map();
  for (const linha of linhas) {
    const dia = data(linha.data);
    const poupanca = numero(linha.poupanca);
    if (dia && poupanca !== null) {
      mapa.set(dia, { poupanca, fonte: texto(linha.fonte) || "planilha" });
    }
  }
  return mapa;
}

/** Guarda o que veio do Bacen, para não perguntar de novo todo dia. */
export async function salvarIndices(linhas = []) {
  await anexar("Indices", linhas);
}

/** Monta as linhas na ordem do cabeçalho da aba. Falta de campo vira vazio. */
function emOrdem(chaves, registro) {
  return chaves.map((chave) => {
    const valor = registro[chave];
    return valor === undefined || valor === null ? "" : valor;
  });
}

/**
 * Anexa no fim da aba. `RAW` de propósito: o nome de um cliente que comece
 * com "=" não pode virar fórmula, e "24:0,7" não pode virar hora.
 */
async function anexar(aba, registros) {
  if (!registros.length) return;
  const chaves = await chavesDa(aba);
  await sheetsClient.spreadsheets.values.append({
    spreadsheetId: planilha(),
    range: `${aba}!A:A`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: registros.map((r) => emOrdem(chaves, r)) },
  });
}

/**
 * Grava parcelas. Parcela que já existe é ATUALIZADA na própria linha; só o
 * que é novo vira linha nova.
 *
 * O Seu Número é a identidade da parcela — o mesmo código que o banco usa no
 * relatório. Se isto fosse só "anexar", uma segunda rodada da régua encheria
 * a aba de parcelas repetidas e o cliente receberia o boleto duas vezes.
 */
export async function escreverParcelas(linhas = []) {
  if (!linhas.length) return;

  const existentes = await lerAba("Parcelas");
  const chaves = await chavesDa("Parcelas");
  const ondeEsta = new Map(
    existentes.map((linha) => [texto(linha.seu_numero).toUpperCase(), linha._linha])
  );

  const atualizar = [];
  const novas = [];

  for (const parcela of linhas) {
    const linha = emOrdem(chaves, parcela);
    const numeroDaLinha = ondeEsta.get(texto(parcela.seu_numero).toUpperCase());
    if (numeroDaLinha) {
      atualizar.push({ range: `Parcelas!A${numeroDaLinha}`, values: [linha] });
    } else {
      novas.push(parcela);
    }
  }

  if (atualizar.length) {
    await sheetsClient.spreadsheets.values.batchUpdate({
      spreadsheetId: planilha(),
      requestBody: { valueInputOption: "RAW", data: atualizar },
    });
  }
  await anexar("Parcelas", novas);
}

/** A lista de trabalho do operador: o que ele precisa emitir no banco. */
export async function escreverBoletosAGerar(linhas = []) {
  await anexar("BoletosAGerar", linhas);
}

/** Tudo que sai e entra. É por aqui que se descobre o que o agente fez. */
export async function registrarHistorico({ contrato = "", evento = "", detalhe = "" } = {}) {
  await anexar("Historico", [
    { data_hora: new Date().toISOString(), contrato, evento, detalhe },
  ]);
}
