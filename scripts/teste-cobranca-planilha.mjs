// A planilha de trabalho do agente de cobrança. Rode da raiz:
//   node scripts/teste-cobranca-planilha.mjs
//
// Sem internet: o dublê de scripts/fake-sheets.mjs faz o papel do Google.
// Os dados do dublê imitam a planilha de verdade, com nomes, telefones e imóveis inventados: o
// Rafael com três séries e DOIS códigos de boleto, o Paulo com a troca de
// taxa em outubro de 2026, a Luana com um `taxa_apos` escrito de um jeito que
// o agente não entende, o Carlos Alberto com valor fixo, e um contrato `fora` que
// não pode ser cobrado.
//
// O que está sendo testado não é ler célula: é NÃO INVENTAR. Coluna vazia
// continua vazia, parcela já escrita não vira uma segunda linha, e a ordem
// das colunas na planilha é quem manda — não a ordem do código.
import { useFakeSheetsClient } from "../src/cobranca/sheets.js";
import { criarDuble, criarVerificador } from "./fake-sheets.mjs";

process.env.COBRANCA_SHEET_ID = "planilha-de-teste";

const { client, valores, chamadas } = criarDuble();

valores.set("Contratos!A:Z", [
  ["codigo", "nome", "telefone", "imovel", "dia_vencimento", "regra", "taxa", "taxa_apos", "situacao", "observacao", "de onde veio"],
  ["C703", "Rafael Moura Lima", "+5511900000015", "Ed. Delta 703", 15, "poupanca+taxa", 0.8, "", "ativo", "", "linha 51"],
  ["A801", "Paulo Henrique Duarte", "", "Ed. Alfa 801", 15, "poupanca+taxa", 0.5, "2026-10:0,7", "ativo", "", "linha 48"],
  ["", "Luana Beatriz F Prado", "", "Lote 17 Quadra 16", 21, "poupanca+taxa", 0.8, "apos a 24a", "ativo", "", "linha 16"],
  ["", "Carlos Alberto", "+5511900000011", "Ed. Beta 303", 12, "fixo", "", "", "ativo", "", "linha 32"],
  ["D103", "Tiago Fernandes da Silva", "", "Ed. Gama 103", 10, "poupanca+taxa", 0.8, "", "fora", "no jurídico", "linha 20"],
]);

valores.set("Series!A:Z", [
  ["contrato", "codigo", "serie", "total", "parcela_atual", "valor_corrente", "vencimento_atual", "periodicidade", "conferir"],
  ["C703", "703", "mensal", 100, 1, 2029.478, "15/08/2026", "mensal", ""],
  ["C703", "", "inter1", 2, 1, 29500, "15/08/2026", "", "CONFERIR com o operador"],
  ["C703", "", "inter2", 8, 1, 30442.17, "15/07/2027", "", "CONFERIR com o operador"],
  ["Paulo Henrique Duarte", "", "mensal", 60, 16, 3815.787955, "15/07/2026", "mensal", ""],
  ["RODOLFO AUGUSTO PEREIRA", "", "inter1", 10, 6, 24638.263731, "01/09/2026", "", "CONFERIR com o operador"],
]);

valores.set("Parcelas!A:Z", [
  ["seu_numero", "contrato", "serie", "numero", "total", "vencimento", "valor", "valor_cheio", "status", "nosso_numero", "pago_em", "valor_pago", "confirmado_por", "memoria"],
  ["C703-01/100", "C703", "mensal", 1, 100, "2026-08-15", 2029.48, 2029.478, "enviado", "00041662", "", "", "", ""],
]);

valores.set("Historico!1:1", [["data_hora", "contrato", "evento", "detalhe"]]);

valores.set("Indices!A:Z", [
  ["data", "poupanca", "fonte", "obtido_em"],
  ["15/09/2026", 0.6451, "bacen", "2026-09-14T20:00:00.000Z"],
  ["18/09/2026", 0.6717, "manual", "2026-09-14T20:00:00.000Z"],
  ["", "", "", ""], // linha em branco no fim da aba: acontece, não pode quebrar
]);

useFakeSheetsClient(client);

const { lerContratos, lerSeries, escreverParcelas, registrarHistorico, lerIndices, salvarIndices } =
  await import("../src/cobranca/planilha.js");
const { check, encerrar } = criarVerificador();

// --- Contratos
const contratos = await lerContratos();

check("lê só os ativos: o que está no jurídico fica de fora", contratos.length === 4);
check(
  "e o contrato de fora não aparece nem pelo nome",
  !contratos.some((c) => c.nome.includes("Tiago"))
);
check("a taxa vira número", contratos[0].taxa === 0.8);
check("dia de vencimento vira número", contratos[0].diaVencimento === 15);
// A virada de taxa do Paulo é por MÊS, como está no contrato dele, e não por
// número de parcela como estava anotado na planilha do operador.
check(
  "a troca de taxa do Paulo é interpretada como mês",
  contratos[1].taxaApos?.desde === "2026-10" && contratos[1].taxaApos?.taxa === 0.7
);
check("quem não tem troca de taxa vem com nulo, não com zero", contratos[0].taxaApos === null);
check(
  "texto que o agente NÃO entende não vira silêncio: fica guardado para virar aviso",
  contratos[2].taxaApos === null && contratos[2].taxaAposBruto === "apos a 24a"
);
check("contrato fixo não exige taxa", contratos[3].regra === "fixo" && contratos[3].taxa === 0);
check("telefone vazio não derruba a leitura", contratos[1].telefone === "");

// A chave que liga Contratos a Series: hoje o operador ainda não passou os
// códigos dos boletos, então a maioria dos contratos casa pelo NOME. Quando
// ele passar, a mesma chave passa a casar pelo código, sem mexer em nada.
check("quem tem código usa o código como chave", contratos[0].chave === "C703");
check("quem não tem código ainda usa o nome", contratos[2].chave === "Luana Beatriz F Prado");

// --- Series
const doRafael = await lerSeries("C703", { codigoDoContrato: "C703" });
check("as três séries do Rafael vêm juntas", doRafael.length === 3);
check(
  "a mensal e as duas intermediárias, cada uma com o seu nome",
  doRafael.map((s) => s.serie).join(" ") === "mensal inter1 inter2"
);
check(
  "o valor vem com TODAS as casas, sem arredondar",
  doRafael[0].valorCorrente === 2029.478
);
check("data brasileira vira data que ordena", doRafael[0].vencimentoAtual === "2026-08-15");
check(
  "periodicidade em branco continua em branco: o leitor não adivinha",
  doRafael[1].periodicidade === ""
);
check(
  "e o bilhete do conferir chega junto",
  doRafael[1].conferir.includes("CONFERIR")
);

// O Rafael é o caso dos dois códigos: a mensal de 100 parcelas não cabe com a
// letra, as intermediárias de 2 parcelas cabem.
check("a série com código próprio usa o dela", doRafael[0].codigo === "703");
check("a série sem código herda o do contrato", doRafael[1].codigo === "C703" && doRafael[2].codigo === "C703");

const doPaulo = await lerSeries("Paulo Henrique Duarte", { codigoDoContrato: "A801" });
check("a série casa pelo nome quando o código está em branco", doPaulo.length === 1);
check(
  "valor grande com seis casas não perde precisão",
  (await lerSeries("RODOLFO AUGUSTO PEREIRA"))[0].valorCorrente === 24638.263731
);
check("e herda o código do contrato", doPaulo[0].codigo === "A801");
check("contrato sem série devolve lista vazia", (await lerSeries("X999")).length === 0);

// --- Escrita das parcelas
chamadas.length = 0;
await escreverParcelas([
  // esta já existe na planilha: tem que ser ATUALIZADA, não duplicada
  { seu_numero: "C703-01/100", contrato: "C703", serie: "mensal", numero: 1, total: 100, vencimento: "2026-08-15", valor: 2029.48, valor_cheio: 2029.478, status: "pago", nosso_numero: "00041662", pago_em: "2026-08-14", valor_pago: 2029.48, confirmado_por: "relatorio", memoria: "" },
  // esta é nova
  { seu_numero: "C703-02/100", contrato: "C703", serie: "mensal", numero: 2, total: 100, vencimento: "2026-09-15", valor: 2045.72, valor_cheio: 2045.7156, status: "a_gerar", memoria: "poup 0,5 + taxa 0,8" },
]);

const atualizacoes = chamadas.filter((c) => c.nome === "values.batchUpdate");
const anexos = chamadas.filter((c) => c.nome === "values.append");

check("a parcela que já existia é atualizada na própria linha", atualizacoes.length === 1);
check(
  "e na linha certa, a 2",
  atualizacoes[0].args.requestBody.data[0].range === "Parcelas!A2"
);
check("a parcela nova é anexada no fim", anexos.length === 1);
check(
  "uma linha nova só, nada de duplicar a que já estava lá",
  anexos[0].args.requestBody.values.length === 1
);
check(
  "o status novo chegou na atualização",
  atualizacoes[0].args.requestBody.data[0].values[0][8] === "pago"
);
check(
  "quem manda na ordem é o cabeçalho da planilha",
  anexos[0].args.requestBody.values[0][0] === "C703-02/100" &&
    anexos[0].args.requestBody.values[0][5] === "2026-09-15"
);
check(
  "campo que não veio vira célula vazia, nunca 'undefined'",
  anexos[0].args.requestBody.values[0].every((v) => v !== undefined && v !== null) &&
    anexos[0].args.requestBody.values[0][10] === ""
);
check(
  "nada é escrito como fórmula: o que vai é texto cru",
  [...atualizacoes, ...anexos].every((c) =>
    (c.args.requestBody.valueInputOption || c.args.valueInputOption) === "RAW"
  )
);

chamadas.length = 0;
await escreverParcelas([]);
check("lista vazia não escreve nada", chamadas.length === 0);

// --- Histórico
chamadas.length = 0;
await registrarHistorico({ contrato: "C703", evento: "boleto_enviado", detalhe: "parcela 2" });
const historico = chamadas.find((c) => c.nome === "values.append");
check("o histórico é anexado", Boolean(historico));
check(
  "com data e hora carimbadas pelo agente",
  /^\d{4}-\d{2}-\d{2}T/.test(historico.args.requestBody.values[0][0])
);
check(
  "e o evento na coluna do cabeçalho",
  historico.args.requestBody.values[0][2] === "boleto_enviado"
);

// --- Índices: o cache da poupança
const indices = await lerIndices();
check("os índices voltam num mapa por data", indices.size === 2);
check("com a data em formato que ordena", indices.get("2026-09-15").poupanca === 0.6451);
check("e a fonte junto, para saber o que é do Bacen e o que é da mão", indices.get("2026-09-18").fonte === "manual");
check("linha em branco no fim da aba é ignorada", !indices.has(""));

chamadas.length = 0;
await salvarIndices([{ data: "2026-09-20", poupanca: 0.6698, fonte: "bacen", obtido_em: "2026-09-14T21:00:00.000Z" }]);
const gravado = chamadas.find((c) => c.nome === "values.append");
check("índice novo é anexado na aba Indices", gravado.args.range.startsWith("Indices"));
check("na ordem do cabeçalho", gravado.args.requestBody.values[0][1] === 0.6698);

// --- Planilha vazia
valores.set("Contratos!A:Z", []);
valores.set("Series!A:Z", []);
check("aba vazia não quebra", (await lerContratos()).length === 0);
check("aba vazia de séries também não", (await lerSeries("C703")).length === 0);

encerrar();
