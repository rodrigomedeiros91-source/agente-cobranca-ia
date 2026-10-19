// A conferência: relatório do banco × parcelas em aberto. Rode da raiz:
//   node scripts/teste-cobranca-conciliacao.mjs
//
// Os casos daqui são os de agosto, com os códigos e valores de verdade. O que
// está sendo testado não é a aritmética: é a decisão de dar ou não baixa numa
// parcela — a única coisa neste projeto que faz o agente parar de cobrar
// alguém.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { conciliar, resumo } from "../src/cobranca/conciliacao.js";
import { lerLiquidados } from "../src/cobranca/relatorios.js";
import { criarVerificador } from "./fake-sheets.mjs";

const { check, encerrar } = criarVerificador();

const parcelas = [
  { seuNumero: "J703-13/40", valor: 3628.98, status: "enviado" },
  { seuNumero: "A801-03/05", valor: 6128.57, status: "enviado" },
  { seuNumero: "P212-09/24", valor: 2876.11, status: "enviado" },
  { seuNumero: "P212-08/24", valor: 2834.51, status: "enviado" },
  { seuNumero: "C303-35/80", valor: 4551.81, status: "pago" },
  { seuNumero: "N501-34/60", valor: 3500.0, status: "enviado" },
];

const lancamentos = [
  { seuNumero: "J703-13/40", valor: 3628.98, baixa: "2026-07-30", situacao: "liquidado", nossoNumero: "00041662" },
  { seuNumero: "A801-03/05", valor: 6128.57, baixa: "2026-08-17", situacao: "baixado", nossoNumero: "00041616" },
  { seuNumero: "P212-08/24", valor: 2834.51, baixa: "2026-08-31", situacao: "baixado", nossoNumero: "00041652" },
  { seuNumero: "P212-09/24", valor: 2876.11, baixa: "2026-08-05", situacao: "liquidado", nossoNumero: "00041682" },
  { seuNumero: "C303-35/80", valor: 4551.81, baixa: "2026-08-10", situacao: "liquidado", nossoNumero: "00041686" },
  { seuNumero: "N501-34/60", valor: 3560.29, baixa: "2026-08-28", situacao: "liquidado", nossoNumero: "00041676" },
  { seuNumero: "X999-01/10", valor: 1000.0, baixa: "2026-08-12", situacao: "liquidado", nossoNumero: "00041699" },
];

const r = conciliar({ lancamentos, parcelas });

check("dá baixa no que bateu exato", r.baixas.length === 2);
check(
  "e a baixa leva a data e o valor que o banco informou",
  r.baixas.find((b) => b.seuNumero === "J703-13/40").pagoEm === "2026-07-30" &&
    r.baixas.find((b) => b.seuNumero === "J703-13/40").valorPago === 3628.98
);

// A regra que mais importa
check(
  "boleto baixado vira alerta e NUNCA baixa",
  r.alertas.some((a) => a.seuNumero === "A801-03/05" && a.tipo === "baixado") &&
    !r.baixas.some((b) => b.seuNumero === "A801-03/05")
);
const oBaixado = r.alertas.find((a) => a.seuNumero === "A801-03/05");
check(
  "o alerta de baixado diz o que é: 60 dias sem pagamento, parcela em aberto",
  oBaixado.detalhe.includes("60 dias") && oBaixado.detalhe.includes("2ª via")
);
check("e marca que precisa de 2ª via, para entrar na lista do operador", oBaixado.precisaDeSegundaVia === true);
check(
  "sem esquecer o caso da Bianca: pode ter sido paga por outro boleto",
  oBaixado.detalhe.includes("outro boleto")
);

check(
  "o caso do Vinicius: a 08 foi baixada e a 09 foi paga, e cada uma vai para o seu lado",
  r.alertas.some((a) => a.seuNumero === "P212-08/24" && a.tipo === "baixado") &&
    r.baixas.some((b) => b.seuNumero === "P212-09/24")
);

check(
  "valor diferente do esperado vira dúvida, não baixa",
  r.duvidas.some(
    (d) => d.seuNumero === "N501-34/60" && d.esperado === 3500 && d.recebido === 3560.29
  ) && !r.baixas.some((b) => b.seuNumero === "N501-34/60")
);

check(
  "parcela já paga é ignorada, não baixada de novo",
  r.ignorados.some((i) => i.seuNumero === "C303-35/80" && i.motivo === "ja-baixado")
);

check(
  "boleto que existe no banco e não na planilha vira alerta",
  r.alertas.some((a) => a.seuNumero === "X999-01/10" && a.tipo === "fora-da-planilha")
);

check(
  "nada é decidido em silêncio: todo lançamento saiu em alguma lista",
  r.baixas.length + r.alertas.length + r.duvidas.length + r.ignorados.length === lancamentos.length
);

// Relatório mandado duas vezes, ou com período que se sobrepõe ao anterior
const repetido = conciliar({ lancamentos: [...lancamentos, lancamentos[0]], parcelas });
check(
  "o mesmo boleto no mesmo arquivo não é baixado duas vezes",
  repetido.baixas.filter((b) => b.seuNumero === "J703-13/40").length === 1 &&
    repetido.ignorados.some((i) => i.motivo === "repetido-no-arquivo")
);

// Diferença de um centavo ainda é diferença
const umCentavo = conciliar({
  lancamentos: [{ seuNumero: "J703-13/40", valor: 3628.97, baixa: "2026-07-30", situacao: "liquidado", nossoNumero: "1" }],
  parcelas,
});
check("um centavo a menos vira dúvida", umCentavo.duvidas.length === 1 && umCentavo.baixas.length === 0);

// Espaço e caixa no código do boleto não podem atrapalhar
const bagunçado = conciliar({
  lancamentos: [{ seuNumero: " j703-13/40 ", valor: 3628.98, baixa: "2026-07-30", situacao: "liquidado", nossoNumero: "2" }],
  parcelas,
});
check("código com espaço ou minúscula continua casando", bagunçado.baixas.length === 1);

// E o caminho inteiro, do arquivo até a decisão
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const texto = readFileSync(path.join(AQUI, "fixtures/relatorio-liquidados.txt"), "utf8");
const doArquivo = conciliar({ lancamentos: lerLiquidados(texto), parcelas });
check(
  "lendo o relatório de agosto inteiro, os 18 lançamentos são classificados",
  doArquivo.baixas.length +
    doArquivo.alertas.length +
    doArquivo.duvidas.length +
    doArquivo.ignorados.length ===
    18
);
// Dos três baixados de agosto, dois estão nas parcelas deste teste e um não.
// Os dois viram alerta "baixado"; o terceiro vira "fora-da-planilha" — mas o
// alerta leva a situação junto, então o operador enxerga os três de qualquer jeito.
check(
  "e os três baixados do mês aparecem entre os alertas, com a situação visível",
  doArquivo.alertas.filter((a) => a.situacao === "baixado").length === 3
);
check(
  "nenhum baixado escorregou para as baixas",
  doArquivo.baixas.every((b) => !["A801-03/05", "P211-10/38", "P212-08/24"].includes(b.seuNumero))
);

// A tarifa de emissão, na conferência
//
// O banco cobra prestação + R$ 5,00. Se a conferência olhasse a prestação,
// TODO boleto do mês viraria "valor diferente" — 19 alertas falsos por mês.
// Num mar de alerta falso, o alerta de verdade some.
const comTarifa = conciliar({
  lancamentos: [
    { seuNumero: "L303-11/25", valor: 4150.33, baixa: "2026-09-12", situacao: "liquidado", nossoNumero: "1" },
  ],
  parcelas: [{ seuNumero: "L303-11/25", valor: 4145.33, valorBoleto: 4150.33, status: "enviado" }],
});
check("o boleto com a tarifa dá baixa normal, sem virar dúvida", comTarifa.baixas.length === 1 && comTarifa.duvidas.length === 0);

const semValorBoleto = conciliar({
  lancamentos: [
    { seuNumero: "L303-11/25", valor: 4150.33, baixa: "2026-09-12", situacao: "liquidado", nossoNumero: "1" },
  ],
  parcelas: [{ seuNumero: "L303-11/25", valor: 4145.33, status: "enviado" }],
});
check(
  "parcela antiga, sem valorBoleto, continua sendo conferida pela prestação",
  semValorBoleto.duvidas.length === 1
);

const tarifaErrada = conciliar({
  lancamentos: [
    { seuNumero: "L303-11/25", valor: 4160.33, baixa: "2026-09-12", situacao: "liquidado", nossoNumero: "1" },
  ],
  parcelas: [{ seuNumero: "L303-11/25", valor: 4145.33, valorBoleto: 4150.33, status: "enviado" }],
});
check(
  "e uma diferença DE VERDADE continua virando dúvida",
  tarifaErrada.duvidas[0].esperado === 4150.33 && tarifaErrada.duvidas[0].recebido === 4160.33
);

check("o resumo sai em português", resumo(r).includes("baixas"));

encerrar();
