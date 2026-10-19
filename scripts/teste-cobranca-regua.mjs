// A régua: quem recebe o quê, e quando. Rode da raiz:
//   node scripts/teste-cobranca-regua.mjs
//
// O relógio é injetado, então dá para testar sábado às 20h01 sem esperar
// sábado. Os contratos imitam os de verdade, com dados inventados.
//
// O que está sendo testado não é "sabe somar dias". É o oposto: as horas em
// que o agente tem que ficar CALADO. Cobrança que insiste demais perde o
// número da empresa no WhatsApp e afronta o CDC — e aí não sobra produto.
import {
  diasEntre,
  somarDias,
  horarioDeFalar,
  eventoDaParcela,
  porQueEstaCalado,
  filaDoDia,
  aindaDaParaPagar,
} from "../src/cobranca/regua.js";
import { criarVerificador } from "./fake-sheets.mjs";

const { check, encerrar } = criarVerificador();

// --- Contas de calendário
check("dias entre duas datas", diasEntre("2026-09-10", "2026-09-15") === 5);
check("e para trás também", diasEntre("2026-09-20", "2026-09-15") === -5);
check("virada de mês não atrapalha", diasEntre("2026-08-30", "2026-09-02") === 3);
check("virada de ano também não", diasEntre("2026-12-30", "2027-01-02") === 3);
check("somar dias", somarDias("2026-09-28", 7) === "2026-10-05");

// --- Horário
check("terça às 9h pode falar", horarioDeFalar("2026-09-15T09:00").pode === true);
check("às 7h59 não", horarioDeFalar("2026-09-15T07:59").pode === false);
check("às 8h em ponto pode", horarioDeFalar("2026-09-15T08:00").pode === true);
check("às 19h59 ainda pode", horarioDeFalar("2026-09-15T19:59").pode === true);
check("às 20h não", horarioDeFalar("2026-09-15T20:00").pode === false);
check("sábado pode", horarioDeFalar("2026-09-19T10:00").pode === true);
check("domingo não", horarioDeFalar("2026-09-20T10:00").pode === false);
check("e o motivo sai escrito", horarioDeFalar("2026-09-20T10:00").motivo === "domingo");

// --- O calendário de uma parcela (vencimento 15/09/2026)
const venc = "2026-09-15";
const ev = (hoje, status) => eventoDaParcela({ vencimento: venc, status, hoje });

check("6 dias antes: nada", ev("2026-09-09") === null);
check("5 dias antes: vai o boleto", ev("2026-09-10").tipo === "boleto");
check("4 dias antes: nada de novo", ev("2026-09-11") === null);
check("no dia: lembrete", ev("2026-09-15").tipo === "lembrete");
check("1 dia depois: silêncio", ev("2026-09-16") === null);
check("2 dias depois: avisa que venceu", ev("2026-09-17").tipo === "venceu");
check("3 dias depois: silêncio de novo", ev("2026-09-18") === null);
check("4 e 6 dias: cobra outra vez", ev("2026-09-19").tipo === "venceu" && ev("2026-09-21").tipo === "venceu");
check("5 e 7 dias: silêncio", ev("2026-09-20") === null && ev("2026-09-22") === null);
check(
  "até o 7º dia a cobrança PODE levar valor, porque o boleto ainda vale",
  !ev("2026-09-21").semValor
);
check(
  "8 dias depois o agente para e a parcela vira trabalho do operador",
  ev("2026-09-23").tipo === "segunda_via" && ev("2026-09-23").interno === true
);
// Do 9º dia em diante o cliente não recebe mais nada: o que sobra é recado
// interno. Confere dia a dia por três meses, para ninguém reintroduzir uma
// mensagem de cobrança lá no meio sem perceber.
// Do 9º ao 30º dia o agente ainda fala, mas SEM valor. Depois do 30º, nunca
// mais: o caso é do operador e do jurídico.
const comValorDepoisDoOitavo = [];
const falouDepoisDos30 = [];
for (let d = 9; d <= 120; d++) {
  const evento = eventoDaParcela({ vencimento: venc, hoje: somarDias(venc, d) });
  if (!evento || evento.interno) continue;
  if (!evento.semValor) comValorDepoisDoOitavo.push(d);
  if (d >= 30) falouDepoisDos30.push(d);
}
check(
  "do 9º dia em diante, NENHUMA mensagem ao cliente pode levar valor",
  comValorDepoisDoOitavo.length === 0
);
check("e a partir do 30º dia o agente não fala mais nada", falouDepoisDos30.length === 0);

// De 2 em 2 dias, como o operador pediu em 28/09/2026. O vencimento é 15/09.
check("10º dia (25/09) cobra", ev("2026-09-25")?.tipo === "em_aberto");
check("11º dia (26/09) não", ev("2026-09-26") === null);
check("12º dia (27/09) cobra", ev("2026-09-27")?.tipo === "em_aberto");
check("e essa mensagem é marcada como sem valor", ev("2026-09-25").semValor === true);
check("o dia de semana não importa mais: domingo 27/09 cai no passo", ev("2026-09-27") !== null);

// O passo tem que ser 2 de verdade, não "às vezes 2". Varre a janela inteira.
const diasQueFalam = [];
for (let d = 1; d < 30; d++) {
  const e = eventoDaParcela({ vencimento: venc, hoje: somarDias(venc, d) });
  if (e && !e.interno) diasQueFalam.push(d);
}
check(
  "fala nos dias pares do 2 ao 28, pulando o 8 que é da 2ª via",
  diasQueFalam.join(",") === "2,4,6,10,12,14,16,18,20,22,24,26,28"
);
check("o 8º dia continua sendo o recado interno da 2ª via", ev("2026-09-23").interno === true);
check("30, 60 e 90 dias são aviso interno, não mensagem",
  ev("2026-10-15").interno && ev("2026-11-14").interno && ev("2026-12-14").interno);
check("no de 90 vai o botão de passar para o dono",
  ev("2026-12-14").botao === "Passar para o dono");

check("parcela paga não gera nada", ev("2026-09-15", "pago") === null);
check("parcela cancelada também não", ev("2026-09-10", "cancelado") === null);
check("parcela pausada também não", ev("2026-09-18", "pausado") === null);

// --- Os freios
const calado = (estado) => porQueEstaCalado({ estado, hoje: "2026-09-15" });
check("contrato com o operador fica parado", calado({ comoperador: true }).includes("operador"));
check("quem prometeu pagar não é cobrado até o dia",
  calado({ prometidoPara: "2026-09-20" }).includes("prometeu"));
check("e no dia seguinte à promessa volta a valer",
  porQueEstaCalado({ estado: { prometidoPara: "2026-09-14" }, hoje: "2026-09-15" }) === null);
check("quem disse que pagou espera o relatório",
  calado({ disseQuePagou: true }).includes("relatório"));
check("uma mensagem por cliente por dia",
  calado({ ultimaMensagemEm: "2026-09-15" }).includes("hoje"));
check("ontem não conta", calado({ ultimaMensagemEm: "2026-09-14" }) === null);
check("sem trava nenhuma, pode falar", calado({}) === null);

// --- A fila do dia, com contratos de verdade
const contratos = [
  { chave: "A801", nome: "Paulo Henrique Duarte", telefone: "+5511900000012", imovel: "Ed. Alfa 801", situacao: "ativo" },
  { chave: "J703", nome: "Mariana Costa de Almeida", telefone: "+5511900000013", situacao: "ativo" },
  { chave: "L303", nome: "Carlos Alberto", telefone: "+5511900000011", situacao: "ativo" },
  { chave: "C703", nome: "Rafael Moura Lima", telefone: "", situacao: "ativo" },
  { chave: "D103", nome: "Tiago Fernandes da Silva", telefone: "+5511900000014", situacao: "fora" },
];
const todosConfirmados = new Map(
  contratos.map((c) => [c.chave, { confirmouQueEEle: true }])
);

const parcelas = [
  { contrato: "A801", seuNumero: "A801-17/60", vencimento: "2026-09-15", status: "enviado", valor: 3900 },
  { contrato: "J703", seuNumero: "J703-16/48", vencimento: "2026-09-20", status: "enviado", valor: 3791.31 },
  { contrato: "L303", seuNumero: "L303-11/25", vencimento: "2026-09-13", status: "enviado", valor: 4150.33 },
  { contrato: "C703", seuNumero: "703-02/100", vencimento: "2026-09-15", status: "enviado", valor: 2045 },
  { contrato: "D103", seuNumero: "D103-61/80", vencimento: "2026-09-15", status: "enviado", valor: 5290.6 },
];

const fila = filaDoDia({
  agora: "2026-09-15T09:30",
  contratos,
  parcelas,
  estados: todosConfirmados,
});

check("o Paulo recebe o lembrete do dia",
  fila.mensagens.some((m) => m.contrato === "A801" && m.tipo === "lembrete"));
check("a Mariana recebe o boleto, 5 dias antes",
  fila.mensagens.some((m) => m.contrato === "J703" && m.tipo === "boleto"));
check("o Carlos Alberto é avisado de que venceu dia 13",
  fila.mensagens.some((m) => m.contrato === "L303" && m.tipo === "venceu"));
check("o Rafael não recebe nada: está sem telefone",
  !fila.mensagens.some((m) => m.contrato === "C703") &&
    fila.calados.some((c) => c.contrato === "C703" && c.motivo.includes("telefone")));
check("o contrato que está fora do piloto não é cobrado",
  !fila.mensagens.some((m) => m.contrato === "D103") &&
    fila.calados.some((c) => c.contrato === "D103" && c.motivo.includes("fora")));
check("ninguém recebe duas mensagens",
  new Set(fila.mensagens.map((m) => m.contrato)).size === fila.mensagens.length);

// --- A apresentação vem antes de qualquer cobrança
const semConfirmar = filaDoDia({
  agora: "2026-09-15T09:30",
  contratos: [contratos[0]],
  parcelas: [parcelas[0]],
  estados: new Map(),
});
check(
  "cliente que nunca confirmou quem é recebe a apresentação, não a cobrança",
  semConfirmar.mensagens[0].tipo === "apresentacao"
);
check(
  "e nenhum valor viaja junto",
  semConfirmar.mensagens[0].parcelas.length === 0
);
check(
  "o texto da apresentação já vem montado, com o nome e o imóvel",
  semConfirmar.mensagens[0].texto.includes("Paulo Henrique Duarte")
);
check(
  "avisando que é um assistente automático",
  /assistente autom[áa]tico/i.test(semConfirmar.mensagens[0].texto)
);
check(
  "e com os dois botões",
  semConfirmar.mensagens[0].opcoes.join(" / ") === "Sou eu / Número errado"
);

// --- Duas coisas no mesmo dia: vale a mais atrasada
const duasCoisas = filaDoDia({
  agora: "2026-09-15T09:30",
  contratos: [contratos[0]],
  parcelas: [
    { contrato: "A801", seuNumero: "A801-16/60", vencimento: "2026-09-13", status: "enviado" },
    { contrato: "A801", seuNumero: "A801-17/60", vencimento: "2026-09-15", status: "enviado" },
  ],
  estados: todosConfirmados,
});
check("uma mensagem só", duasCoisas.mensagens.length === 1);
check("e é a da parcela mais atrasada", duasCoisas.mensagens[0].tipo === "venceu");
check("com o motivo explicado", duasCoisas.mensagens[0].porque.includes("mais atrasada"));

// --- Dois boletos no mesmo dia viajam juntos
const doisBoletos = filaDoDia({
  agora: "2026-09-15T09:30",
  contratos: [contratos[1]],
  parcelas: [
    { contrato: "J703", seuNumero: "J703-16/48", vencimento: "2026-09-20", status: "enviado" },
    { contrato: "J703", seuNumero: "J703-01/04", vencimento: "2026-09-20", status: "enviado" },
  ],
  estados: todosConfirmados,
});
check("uma mensagem com os dois boletos dentro",
  doisBoletos.mensagens.length === 1 && doisBoletos.mensagens[0].parcelas.length === 2);

// --- Fora de hora
const noite = filaDoDia({ agora: "2026-09-15T22:00", contratos, parcelas, estados: todosConfirmados });
check("às 22h a fila é montada mas segurada", noite.segura === true && noite.mensagens.length > 0);
const domingo = filaDoDia({ agora: "2026-09-20T10:00", contratos, parcelas, estados: todosConfirmados });
check("domingo também segura", domingo.segura === true);

// --- Os recados do operador saem mesmo com o cliente calado
const comoperador = filaDoDia({
  agora: "2026-09-15T09:30",
  contratos: [contratos[0]],
  parcelas: [{ contrato: "A801", seuNumero: "A801-10/60", vencimento: "2026-09-07", status: "enviado" }],
  estados: new Map([["A801", { confirmouQueEEle: true, comoperador: true }]]),
});
check(
  "o cliente está com o operador, então não recebe mensagem",
  comoperador.mensagens.length === 0
);
check(
  "mas o pedido de 2ª via chega ao operador assim mesmo",
  comoperador.interno.some((i) => i.tipo === "segunda_via")
);

// --- O texto do boleto vencido
// O operador explicou em 18/09: até 7 dias ELE altera a data do boleto no app do
// banco, e aí não tem acréscimo. Quem altera é ele — o agente só pede.
const dentro = aindaDaParaPagar({ vencimento: "2026-09-12", hoje: "2026-09-15" });
check("até 7 dias o boleto ainda dá para ajustar", dentro.vale === true);
check("e ainda dá para o operador adiar a data", dentro.podeAdiar === true);
check("o prazo limite volta como dado, não como frase", dentro.ate === "2026-09-19");
check(
  "o texto do reenvio é neutro: não oferece adiamento a quem não pediu",
  !/vou pedir para mudarem/i.test(dentro.texto)
);
check(
  "e NUNCA garante isenção — quem altera o boleto é o operador, não o agente",
  !dentro.texto.toLowerCase().includes("sem acréscimo") &&
    !dentro.texto.toLowerCase().includes("sem acrescimo")
);
const emDia = aindaDaParaPagar({ vencimento: "2026-09-20", hoje: "2026-09-15" });
check("boleto em dia também pode ser adiado", emDia.podeAdiar === true);
const fora = aindaDaParaPagar({ vencimento: "2026-09-01", hoje: "2026-09-15" });
check("depois de 7 dias vira pedido de 2ª via", fora.vale === false);
check("e aí nem o operador consegue alterar: o boleto morreu", fora.podeAdiar === false);
check("e o agente não promete valor nenhum", !/\d+,\d{2}/.test(fora.texto));

check("lista vazia não quebra", filaDoDia({ agora: "2026-09-15T09:30" }).mensagens.length === 0);

encerrar();
