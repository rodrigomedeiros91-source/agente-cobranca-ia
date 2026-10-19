// A calculadora do agente de cobrança. Rode da raiz:
//   node scripts/teste-cobranca-calculo.mjs
//
// No projeto do cliente, este teste também refaz, um por um, os 17 mil meses
// que o operador calculou na planilha desde 2005, e todos batem em centavos.
// Esses casos são dados reais de clientes e ficam no repositório privado; aqui
// ficam as regras, com valores de exemplo.
import {
  fator,
  corrigir,
  arredondar,
  taxaDoContrato,
  aplicarFator,
  valorDoBoleto,
  memoriaDoBoleto,
  TARIFA_BOLETO,
} from "../src/cobranca/calculo.js";
import { criarVerificador } from "./fake-sheets.mjs";

const { check, encerrar } = criarVerificador();

// 1. O fator, como está escrito na célula E da planilha
check(
  "fator de 0,8 + 0,6739 é 1,014739",
  Math.abs(fator({ taxa: 0.8, poupanca: 0.6739 }) - 1.014739) < 1e-12
);

// 2. A conta do mês, no contrato do Rafael (Ed. Delta 703)
const felipe = corrigir({ valorAtual: 2000, taxa: 0.8, poupanca: 0.6739 });
check("prestação do Rafael, mês 1: 2.029,478 cheio", Math.abs(felipe.valorCheio - 2029.478) < 1e-9);
check("e 2.029,48 no boleto", felipe.valor === 2029.48);
check(
  "a memória de cálculo mostra a conta aberta",
  felipe.memoria.includes("2.000,00") &&
    felipe.memoria.includes("0,6739%") &&
    felipe.memoria.includes("0,8%") &&
    felipe.memoria.includes("1,014739")
);

// O mês seguinte parte do valor CHEIO, não do arredondado
const felipe2 = corrigir({ valorAtual: felipe.valorCheio, taxa: 0.8, poupanca: 0.6451 });
check("prestação do Rafael, mês 2: 2.058,81", felipe2.valor === 2058.81);

// 3. Arredondamento: os dois casos que o histórico tem, na metade exata
check("2.527,055 vira 2.527,06", arredondar(2527.055) === 2527.06);
check("5.050,125 vira 5.050,13", arredondar(5050.125) === 5050.13);
check("2,004 continua 2,00", arredondar(2.004) === 2.0);
check(
  "5025 × 1,005 fecha em 5.050,13, como na planilha (em JS puro daria 5.050,12)",
  aplicarFator({ valorAtual: 5025, fator: 1.005 }).valor === 5050.13
);

// 4. A troca de taxa do Paulo (Ed. Alfa 801).
//
// O contrato dele: poupança + 0,5% até setembro de 2026, poupança + 0,7% a
// partir de outubro de 2026. A anotação da planilha ("após 24ª") está errada —
// o próprio operador corrigiu em 15/09/2026: seria a 19, e o que vale é o mês.
const silvio = { taxa: 0.5, taxaApos: { desde: "2026-10", taxa: 0.7 } };
check("Paulo em setembro de 2026 ainda usa 0,5", taxaDoContrato(silvio, "2026-09-15") === 0.5);
check("Paulo em outubro de 2026 passa a usar 0,7", taxaDoContrato(silvio, "2026-10-15") === 0.7);
check("e daí para a frente continua 0,7", taxaDoContrato(silvio, "2031-03-15") === 0.7);
check("no último dia de setembro ainda é 0,5", taxaDoContrato(silvio, "2026-09-30") === 0.5);
check("contrato sem troca usa sempre a mesma taxa", taxaDoContrato({ taxa: 0.8 }, "2030-01-10") === 0.8);
check("sem vencimento, fica na taxa base — nunca chuta a nova", taxaDoContrato(silvio, "") === 0.5);

// 5. Contrato fixo (Carlos Alberto, Ed. Beta 303): sem correção nenhuma
const fixo = corrigir({ valorAtual: 4145.33, regra: "fixo" });
check("contrato fixo devolve o mesmo valor", fixo.valorCheio === 4145.33 && fixo.valor === 4145.33);
check("e a memória diz que é fixo", fixo.memoria.includes("fixo"));

// --------------------------------------------------------------------------
// A tarifa de emissão do boleto
//
// O Itaú cobra R$ 5,00 por boleto e esse valor vai no boleto. Os casos abaixo
// são reais: a prestação saiu da planilha do operador e o valor do boleto saiu
// do relatório do banco.
// --------------------------------------------------------------------------
check("a tarifa é de R$ 5,00", TARIFA_BOLETO === 5);

const DO_BANCO = [
  ["Ed. Beta 303  (L303-11/25)", 4145.33, 4150.33],
  ["Lote 10 Quadra 15 (P10-05/30)", 2591.31, 2596.31],
  ["Ed. Kappa 201    (R201-42/70)", 3618.38, 3623.38],
  ["Lote 02 Quadra 12 (P212-09/24)", 2871.11, 2876.11],
];
for (const [nome, prestacao, oQueOBancoCobra] of DO_BANCO) {
  check(`${nome}: prestação + tarifa dá o valor do boleto`, valorDoBoleto(prestacao) === oQueOBancoCobra);
}

// A REGRA QUE FAZ A TARIFA EXISTIR NUM LUGAR SÓ
//
// Se a tarifa entrasse no valor que corrige o mês seguinte, ela seria
// corrigida junto, todo mês, para sempre. Em 100 parcelas o cliente pagaria
// juros sobre uma tarifa bancária — e ninguém veria, porque a diferença
// mensal é de centavos.
const mes1 = corrigir({ valorAtual: 4145.33, taxa: 0.8, poupanca: 0.6739 });
const mes2Certo = corrigir({ valorAtual: mes1.valorCheio, taxa: 0.8, poupanca: 0.6739 });
const mes2Errado = corrigir({ valorAtual: valorDoBoleto(mes1.valor), taxa: 0.8, poupanca: 0.6739 });

check(
  "a correção do mês seguinte parte da PRESTAÇÃO, não do valor do boleto",
  mes2Certo.valor < mes2Errado.valor
);
check(
  "e a diferença, já no segundo mês, é de mais de R$ 5,00 — porque a tarifa teria sido corrigida junto",
  Number((mes2Errado.valor - mes2Certo.valor).toFixed(2)) > 5
);
check(
  "corrigir() nunca devolve a tarifa embutida",
  mes1.valor === arredondar(mes1.valorCheio) && !mes1.memoria.includes("Tarifa")
);

// Um contrato inteiro: a tarifa nunca se acumula
let comTarifa = 2029.478;
let semTarifa = 2029.478;
for (let i = 0; i < 24; i++) {
  semTarifa = corrigir({ valorAtual: semTarifa, taxa: 0.8, poupanca: 0.67 }).valorCheio;
  comTarifa = corrigir({ valorAtual: valorDoBoleto(arredondar(comTarifa)), taxa: 0.8, poupanca: 0.67 }).valorCheio;
}
check(
  "depois de 24 meses, misturar a tarifa custaria mais de R$ 130 ao cliente",
  comTarifa - semTarifa > 130
);

// A memória, que é o que o operador lê antes de emitir
const memoria = memoriaDoBoleto({ prestacao: 4145.33 });
check("a memória do boleto mostra a prestação", memoria.includes("4.145,33"));
check("mostra a tarifa em separado", memoria.includes("5,00"));
check("mostra o total que vai no boleto", memoria.includes("4.150,33"));
check("e avisa que a tarifa não corrige", memoria.includes("não entra na correção"));

// Tarifa diferente, se um dia o banco mudar
check("a tarifa pode ser outra sem mexer no código", valorDoBoleto(1000, 3.5) === 1003.5);

encerrar();
