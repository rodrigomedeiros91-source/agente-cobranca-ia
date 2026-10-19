// Leitura dos relatórios do Itaú. Rode da raiz:
//   node scripts/teste-cobranca-relatorios.mjs
//
// As fixtures são o texto dos relatórios de VERDADE, com os nomes dos pagadores
// trocados por nomes inventados do mesmo tamanho e com agência, conta e CNPJ
// mascarados. Datas, valores, códigos de boleto e o alinhamento das colunas são
// os originais — é neles que o leitor tropeça, não nos nomes.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  lerLiquidados,
  lerEmAberto,
  montarSeuNumero,
  problemaNoSeuNumero,
} from "../src/cobranca/relatorios.js";
import { criarVerificador } from "./fake-sheets.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const liquidados = readFileSync(path.join(AQUI, "fixtures/relatorio-liquidados.txt"), "utf8");
const emAberto = readFileSync(path.join(AQUI, "fixtures/relatorio-em-aberto.txt"), "utf8");
const { check, encerrar } = criarVerificador();

// --- Relatório de agosto: o que foi pago e o que foi cancelado
const pagos = lerLiquidados(liquidados);

check("leu os 18 lançamentos do relatório de agosto", pagos.length === 18);
check("15 liquidados", pagos.filter((p) => p.situacao === "liquidado").length === 15);
check("3 baixados", pagos.filter((p) => p.situacao === "baixado").length === 3);

const umPago = pagos.find((p) => p.seuNumero === "J703-13/40");
check("achou o boleto pelo Seu Número", Boolean(umPago));
check("valor com ponto e vírgula vira número", umPago.valor === 3628.98);
check("vencimento lido e ordenável", umPago.vencimento === "2026-07-30");
check("data da baixa lida", umPago.baixa === "2026-07-30");
check("nosso número preserva os zeros à esquerda", umPago.nossoNumero === "00041662");

// A regra que mais importa deste arquivo inteiro
const baixado = pagos.find((p) => p.seuNumero === "A801-03/05");
check("o boleto baixado NÃO é lido como pago", baixado.situacao === "baixado");
check(
  "e os três baixados são os que a gente viu no relatório",
  pagos
    .filter((p) => p.situacao === "baixado")
    .map((p) => p.seuNumero)
    .sort()
    .join(" ") === "A801-03/05 P211-10/38 P212-08/24"
);

// Valor alto, com milhar: o campo do Jorge tem 11 mil
check(
  "valor na casa dos milhares",
  pagos.find((p) => p.seuNumero === "R602-34/60").valor === 11533.94
);

// --- Relatório de 11/09: o que está em aberto
const abertos = lerEmAberto(emAberto);

check("leu os 21 boletos em aberto", abertos.length === 21);
check("9 estão vencidos", abertos.filter((b) => b.vencido).length === 9);
check(
  "a soma dos vencidos é R$ 108.241,01",
  Math.abs(abertos.filter((b) => b.vencido).reduce((s, b) => s + b.valor, 0) - 108241.01) < 0.005
);
check(
  "todo boleto saiu com o Seu Número montado das duas linhas",
  abertos.every((b) => b.seuNumero)
);
check(
  "inclusive o do Rafael, que vem sem a letra do prédio",
  abertos.some((b) => b.seuNumero === "703-01/100")
);
check(
  "e as duas intermediárias dele, que vêm com a letra",
  abertos.filter((b) => b.seuNumero.startsWith("C703-")).length === 2
);
check(
  "boleto a vencer não é marcado como vencido",
  abertos.find((b) => b.seuNumero === "B301-20/38").vencido === false
);

// O cabeçalho tem agência, conta e CNPJ da empresa. Nada disso pode sair daqui.
const tudo = JSON.stringify([pagos, abertos]);
check(
  "nenhum dado bancário da empresa entra no resultado",
  !tudo.includes("0000 / 00000-0") && !tudo.includes("00.000.000") && !tudo.includes("Agência")
);

// --- Montar o código do boleto, com o limite de 10 caracteres do Itaú
check("monta o código no formato do banco", montarSeuNumero({ codigo: "A801", parcela: 4, total: 5 }) === "A801-04/05");
check("parcela de um dígito ganha o zero na frente", montarSeuNumero({ codigo: "J703", parcela: 1, total: 48 }) === "J703-01/48");
check("parcela de dois dígitos passa igual", montarSeuNumero({ codigo: "B301", parcela: 20, total: 38 }) === "B301-20/38");
check(
  "o Rafael: a mensal usa o código sem a letra, e cabe em 10",
  montarSeuNumero({ codigo: "703", parcela: 1, total: 100 }) === "703-01/100" &&
    problemaNoSeuNumero("703-01/100") === null
);
check(
  "e a intermediária dele, com a letra, também cabe",
  montarSeuNumero({ codigo: "C703", parcela: 1, total: 2 }) === "C703-01/02" &&
    problemaNoSeuNumero("C703-01/02") === null
);
check(
  "com a letra na mensal de 100 estouraria o limite, e o agente avisa em vez de gerar",
  problemaNoSeuNumero(montarSeuNumero({ codigo: "C703", parcela: 1, total: 100 })).includes("11 caracteres")
);
check("boleto sem código também é problema", problemaNoSeuNumero("").includes("sem código"));
check(
  "todos os 21 boletos em aberto de verdade cabem no limite do Itaú",
  abertos.every((b) => problemaNoSeuNumero(b.seuNumero) === null)
);

check("texto vazio não quebra", lerLiquidados("").length === 0 && lerEmAberto("").length === 0);
check("texto nulo não quebra", lerLiquidados(null).length === 0 && lerEmAberto(null).length === 0);

encerrar();
