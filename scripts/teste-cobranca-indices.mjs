// A poupança do Banco Central. Rode da raiz:
//   node scripts/teste-cobranca-indices.mjs
//
// Sem internet: a fixture é a resposta DE VERDADE da série 195 do SGS,
// baixada em 14/09/2026, cobrindo os vencimentos de julho a setembro.
//
// O teste mais importante deste arquivo não é "sabe ler JSON". É o último:
// ele pega as correções que o operador fez à mão nesses três meses e mostra,
// uma por uma, onde a série oficial e a digitação dele discordam.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  lerSerie,
  url,
  serieDoDia,
  aniversario,
  poupancaDoDia,
  poupancaDosDias,
  paraGravar,
} from "../src/cobranca/indices.js";
import { criarVerificador } from "./fake-sheets.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RESPOSTA = JSON.parse(
  readFileSync(path.join(AQUI, "fixtures/bacen-poupanca-195.json"), "utf8")
);
const { check, encerrar } = criarVerificador();

// Toda busca do teste devolve a fixture e anota que foi chamada.
let buscas = [];
const buscar = async (endereco) => {
  buscas.push(endereco);
  return RESPOSTA;
};

// --- O endereço do Bacen
check("monta o endereço com data brasileira", url({ de: "2026-08-01", ate: "2026-09-30" }).includes("dataInicial=01/08/2026&dataFinal=30/09/2026"));
check("hoje é a série nova", serieDoDia("2026-09-15") === 195);
check("antes de 04/05/2012 é a série antiga", serieDoDia("2010-03-01") === 25);
check("o dia da virada já é a série nova", serieDoDia("2012-05-04") === 195);

// --- Os dias 29, 30 e 31, que não existem na poupança
check("dia comum é ele mesmo", aniversario("2026-09-15") === "2026-09-15");
check("dia 30 recebe no dia 1º do mês seguinte", aniversario("2026-08-30") === "2026-09-01");
check("dia 29 também", aniversario("2026-08-29") === "2026-09-01");
check("dia 31 também", aniversario("2026-07-31") === "2026-08-01");
check("e na virada do ano vai para janeiro", aniversario("2026-12-30") === "2027-01-01");

// --- A leitura da série
const serie = lerSerie(RESPOSTA);
check("leu a série inteira", serie.size === 77);
check("a série do Bacen não tem dia 29, 30 nem 31", ![...serie.keys()].some((d) => Number(d.slice(-2)) >= 29));
check(
  "a chave é o dia do CRÉDITO (dataFim), não o da aplicação",
  serie.get("2026-09-15") === 0.6451 && !serie.has("2026-08-15-errado")
);
check("valor vira número", typeof serie.get("2026-09-20") === "number");
check("aceita o JSON como texto também", lerSerie(JSON.stringify(RESPOSTA)).size === 77);
check("lista vazia não quebra", lerSerie([]).size === 0);
check("nulo não quebra", lerSerie(null).size === 0);

// --- A busca
buscas = [];
const um = await poupancaDoDia("2026-09-15", { buscar });
check("acha a poupança do dia 15/09", um.poupanca === 0.6451 && um.fonte === "bacen");

buscas = [];
const varios = await poupancaDosDias(
  ["2026-09-05", "2026-09-10", "2026-09-15", "2026-09-20", "2026-08-15"],
  { buscar }
);
check("cinco vencimentos, UMA chamada ao Bacen", buscas.length === 1);
check(
  "e cada um com o seu número",
  varios.get("2026-09-05").poupanca === 0.6734 &&
    varios.get("2026-09-10").poupanca === 0.6718 &&
    varios.get("2026-09-20").poupanca === 0.6698 &&
    varios.get("2026-08-15").poupanca === 0.6739
);

// O Ed. Sigma 703 e o Ed. Ômega 103 vencem dia 30. Sem a regra do aniversário, esses
// dois contratos nunca teriam índice.
buscas = [];
const dia30 = await poupancaDosDias(["2026-08-30"], { buscar });
check(
  "vencimento dia 30 usa o rendimento creditado no dia 1º do mês seguinte",
  dia30.get("2026-08-30").poupanca === 0.6701 &&
    dia30.get("2026-08-30").aniversario === "2026-09-01"
);

// A regra que mais importa deste arquivo
buscas = [];
const inexistente = await poupancaDosDias(["2026-10-15"], { buscar });
check(
  "dia que o Bacen não publicou NÃO vira o dia mais próximo: vira nulo",
  inexistente.get("2026-10-15").poupanca === null
);
check(
  "e o motivo sai escrito, para virar aviso e não boleto errado",
  inexistente.get("2026-10-15").motivo.includes("15/10/2026")
);

// --- O que já está na planilha
buscas = [];
const daPlanilha = await poupancaDosDias(["2026-09-15"], {
  jaTemos: new Map([["2026-09-15", { poupanca: 0.6451, fonte: "bacen" }]]),
  buscar,
});
check("o que já está na planilha não é buscado de novo", buscas.length === 0);
check("e volta com o valor guardado", daPlanilha.get("2026-09-15").poupanca === 0.6451);

buscas = [];
const corrigidoAMao = await poupancaDosDias(["2026-09-15"], {
  jaTemos: new Map([["2026-09-15", { poupanca: 0.7, fonte: "manual" }]]),
  buscar,
});
check(
  "número que o operador corrigiu à mão na planilha manda no do Bacen",
  corrigidoAMao.get("2026-09-15").poupanca === 0.7 &&
    corrigidoAMao.get("2026-09-15").fonte === "manual"
);

// --- Bacen fora do ar
const caiu = await poupancaDosDias(["2026-09-15"], {
  buscar: async () => {
    throw new Error("timeout");
  },
});
check("Bacen fora do ar não derruba o agente", caiu.get("2026-09-15").poupanca === null);
check("e explica o que houve", caiu.get("2026-09-15").motivo.includes("Banco Central"));

// --- O que vai para a aba Indices
const gravar = paraGravar(varios);
check("só grava o que veio do Bacen", gravar.length === 5);
check(
  "com data, valor, fonte e quando foi obtido",
  gravar[0].data && gravar[0].poupanca && gravar[0].fonte === "bacen" && gravar[0].obtido_em
);
check("nada para gravar quando não achou", paraGravar(inexistente).length === 0);
check("e não regrava o que já estava na planilha", paraGravar(daPlanilha).length === 0);

// --------------------------------------------------------------------------
// A prova: a série oficial × o que o operador digitou
//
// Estes são os números que estão na planilha dele, nas colunas de fator, para
// os vencimentos de julho a setembro de 2026. Não é exemplo inventado.
// --------------------------------------------------------------------------
const DIGITADO_PELO_OPERADOR = [
  ["2026-07-06", 0.6797], ["2026-07-10", 0.6734], ["2026-07-12", 0.6715],
  ["2026-07-15", 0.6731], ["2026-07-18", 0.6726], ["2026-07-20", 0.6607],
  ["2026-08-05", 0.6722], ["2026-08-08", 0.6722], ["2026-08-10", 0.6703],
  ["2026-08-15", 0.6739], ["2026-08-18", 0.6702], ["2026-08-20", 0.674],
  ["2026-08-30", 0.6701], ["2026-09-05", 0.6734], ["2026-09-08", 0.6734],
  ["2026-09-10", 0.6718], ["2026-09-15", 0.6451], ["2026-09-18", 0.6702],
  ["2026-09-20", 0.6698],
];

const oficiais = await poupancaDosDias(
  DIGITADO_PELO_OPERADOR.map(([d]) => d),
  { buscar }
);

const divergem = DIGITADO_PELO_OPERADOR.filter(([data, dele]) => {
  const oficial = oficiais.get(data).poupanca;
  return oficial !== null && Math.abs(oficial - dele) > 1e-9;
});

check(
  "a série oficial cobre todos os vencimentos do operador nesses três meses",
  DIGITADO_PELO_OPERADOR.every(([d]) => oficiais.get(d).poupanca !== null)
);
check(
  "e reproduz a digitação dele em 14 dos 19 (as 5 diferenças são erro de digitação, listadas abaixo)",
  DIGITADO_PELO_OPERADOR.length === 19 && divergem.length === 5
);

console.log("\n   onde a digitação do operador e o Banco Central discordam:");
for (const [data, dele] of divergem) {
  const oficial = oficiais.get(data).poupanca;
  const centavos = ((Math.abs(oficial - dele) / 100) * 3000).toFixed(2);
  console.log(
    `     ${data}  ele ${dele}  oficial ${oficial}  ` +
      `(≈ R$ ${centavos} numa parcela de R$ 3.000)`
  );
}
console.log("");

encerrar();
