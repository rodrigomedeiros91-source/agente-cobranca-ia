// A conversa: o prompt e as quatro ferramentas. Rode da raiz:
//   node scripts/teste-cobranca-conversa.mjs
//
// Sem rede e sem planilha: os efeitos entram injetados e o teste só olha a
// DECISÃO — mandar ou não mandar o boleto, chamar ou não chamar o operador.
//
// Quase todo teste daqui é sobre o que o agente se recusa a fazer. Numa
// conversa sobre dívida, o estrago não vem de responder pouco: vem de afirmar
// um valor que não existe, confirmar um pagamento que ninguém viu, ou soltar
// uma ameaça que é ilegal no Código de Defesa do Consumidor.
import {
  buildSystemPrompt,
  buildSystemBlocks,
  cartaoDoCliente,
  toolDefinitions,
  runTool,
} from "../src/cobranca/index.js";
import { expressoesCafonas } from "../src/nucleo/tom.js";
import { criarVerificador } from "./fake-sheets.mjs";

const { check, encerrar } = criarVerificador();
const HOJE = "2026-09-15";

const CARTAO = {
  nome: "Paulo Henrique Duarte",
  contrato: "A801",
  imovel: "Ed. Alfa 801",
  confirmouQueEEle: true,
  parcelas: [
    { seuNumero: "A801-04/05", vencimento: "2026-09-12", valor: 6128.57, status: "enviado", vencido: true },
    { seuNumero: "A801-05/05", vencimento: "2026-10-16", valor: 6200.0, status: "enviado" },
  ],
};

// Recolhe o que cada ferramenta MANDOU acontecer, em vez de deixar acontecer.
function espiao() {
  const feitos = [];
  return {
    feitos,
    efeitos: {
      enviarBoleto: async (x) => feitos.push({ o: "enviou boleto", ...x }),
      pedirSegundaVia: async (x) => feitos.push({ o: "pediu 2a via", ...x }),
      gravar: async (x) => feitos.push({ o: "gravou", ...x }),
      avisaroperador: async (x) => feitos.push({ o: "chamou robson", ...x }),
      pedirAdiamento: async (x) => feitos.push({ o: "pediu adiamento", ...x }),
    },
  };
}
const chamar = (nome, entrada, cartao = CARTAO, hoje = HOJE) => {
  const e = espiao();
  return runTool(nome, entrada, "+5511900000012", { cartao, hoje, efeitos: e.efeitos })
    .then((r) => ({ r: JSON.parse(r), feitos: e.feitos }));
};

// ---------------------------------------------------------------- o prompt
const prompt = buildSystemPrompt({ cartao: CARTAO, hoje: HOJE });

check("o prompt sai em português", /você|cliente|boleto/i.test(prompt));
check("diz que não é cobrador", prompt.includes("Você não é um cobrador"));

// As proibições, uma a uma
check("proíbe inventar valor", /NUNCA invente, calcule ou estime valor/.test(prompt));
check("proíbe dar desconto", /NUNCA dê desconto/.test(prompt));
check("proíbe mudar vencimento", /NUNCA mude vencimento/.test(prompt));
check("proíbe confirmar pagamento", /NUNCA confirme pagamento/.test(prompt));
check("proíbe pedir senha ou dado bancário", /NUNCA peça senha/.test(prompt));
check(
  "proíbe ameaça, com as palavras que a gente não quer ver",
  /nome sujo/.test(prompt) && /SPC/.test(prompt) && /Serasa/.test(prompt) && /protesto/.test(prompt)
);
check(
  "proíbe falar da dívida com outra pessoa",
  /NUNCA fale da dívida com outra pessoa/.test(prompt)
);
check("proíbe insistir", /NUNCA insista/.test(prompt));

// A regra do tom, que vale para todos os agentes deste projeto
check(
  "o prompt NÃO ensina expressão cafona",
  expressoesCafonas(prompt.replace(/Nada de "[^"]*"[^.]*\./g, "")).length === 0
);
check(
  "e ainda proíbe as principais pelo nome",
  /sinto muito/.test(prompt) && /fique tranquilo/.test(prompt)
);

// A regra de saúde do projeto entra de graça
check("a regra de saúde do projeto está dentro", prompt.includes("SAÚDE: O QUE VOCÊ NUNCA FAZ"));
check("inclusive a parte do 192", prompt.includes("192"));

// Quando chamar gente de verdade
for (const caso of [
  "desconto",
  "renegociação",
  "advogado",
  "doença",
  "morte",
  // Os três de baixo vieram dos prints de conversa do operador (22/09/2026), não
  // da nossa imaginação: são coisas que clientes de verdade escreveram e que o
  // agente não sabia tratar.
  "PIX",
  "notificação extrajudicial",
  "desespero",
]) {
  check(`manda chamar o responsável em caso de ${caso}`, prompt.includes(caso));
}

// PIX é o caso mais traiçoeiro dos três: parece ajuda, e quebra a conciliação.
// Quem paga fora do boleto não aparece no relatório do banco, então ninguém dá
// baixa e a régua volta a cobrar em cima de quem já pagou.
check("proíbe passar chave PIX ou dado de conta", /NUNCA passe chave PIX/.test(prompt));
check(
  "e desarma o argumento que o cliente de verdade usou",
  /limite do\s+boleto dela é baixo/s.test(prompt) || /limite do boleto/.test(prompt)
);
check(
  "notificação extrajudicial: o agente não explica nem opina",
  /não explique o que é/.test(prompt) && /não diga se procede/.test(prompt)
);
check("e ela entra na lista de urgência 'agora'", /urgência "agora".*extrajudicial/s.test(prompt));
check(
  "comprovante manda marcar o campo que leva o arquivo para uma pessoa",
  /comprovante: true/.test(prompt)
);

// ---------------------------------------------------------------- o cartão
check("o cartão traz o nome do cliente", prompt.includes("Paulo Henrique Duarte"));
check("e as parcelas com código e valor", prompt.includes("A801-04/05") && prompt.includes("6.128,57"));
check("com a data em português", prompt.includes("12/09/2026"));
check("marca a parcela vencida", /A801-04\/05.*vencida/s.test(prompt));
check("e diz que hoje é hoje", prompt.includes("15/09/2026"));
check(
  "o cartão do OUTRO cliente não aparece",
  !prompt.includes("Mariana") && !prompt.includes("J703")
);

const semNada = buildSystemPrompt({ cartao: { nome: "Fulano", parcelas: [] }, hoje: HOJE });
check("cliente sem parcela em aberto é dito com todas as letras", semNada.includes("nenhuma"));

const naoConfirmado = buildSystemPrompt({
  cartao: { nome: "Fulano", confirmouQueEEle: false, parcelas: CARTAO.parcelas },
  hoje: HOJE,
});
check(
  "quem não confirmou quem é não recebe valor nem boleto",
  naoConfirmado.includes("NÃO confirmou que é o titular")
);

const prometeu = buildSystemPrompt({ cartao: { ...CARTAO, prometidoPara: "2026-09-25" }, hoje: HOJE });
check("promessa de pagamento aparece no cartão", prometeu.includes("25/09/2026"));
const pagou = buildSystemPrompt({ cartao: { ...CARTAO, disseQuePagou: true }, hoje: HOJE });
check("quem disse que pagou aparece, com a ordem de não confirmar", pagou.includes("não confirme o pagamento"));

// Cache: a parte grande vai cacheada, o cartão não
const blocos = buildSystemBlocks({ cartao: CARTAO, hoje: HOJE });
check("são dois blocos", blocos.length === 2);
check("o primeiro é cacheado", blocos[0].cache_control?.type === "ephemeral");
check("e é o grande", blocos[0].text.length > blocos[1].text.length);
check("o cartão do cliente NÃO é cacheado", !blocos[1].cache_control);
check("o valor do cliente está fora do cache", !blocos[0].text.includes("6.128,57"));

// ---------------------------------------------------------------- as tools
check("são quatro ferramentas, e só", toolDefinitions.length === 4);
check(
  "com estes nomes",
  toolDefinitions.map((t) => t.name).sort().join(" ") ===
    "chamar_operador reenviar_boleto registrar_data_pagamento registrar_pagamento_informado"
);
check(
  "nenhuma ferramenta calcula, muda vencimento ou dá baixa",
  !toolDefinitions.some((t) => /calcul|desconto|baixa|quitar/i.test(t.name))
);

// reenviar_boleto: dentro do prazo
const dentro = await chamar("reenviar_boleto", { seu_numero: "A801-04/05" });
check("boleto vencido há 3 dias ainda é reenviado", dentro.r.ok === true);
check("e o PDF realmente sai", dentro.feitos.some((f) => f.o === "enviou boleto"));
check(
  "o texto do reenvio é neutro e não promete isenção nem adiamento",
  !dentro.r.instruction.toLowerCase().includes("sem acréscimo") &&
    !/mudarem a data/i.test(dentro.r.instruction)
);

// reenviar_boleto: fora do prazo
const fora = await chamar(
  "reenviar_boleto",
  { seu_numero: "A801-04/05" },
  { ...CARTAO, parcelas: [{ seuNumero: "A801-04/05", vencimento: "2026-08-01", valor: 6128.57, status: "enviado" }] }
);
check("boleto de mais de 7 dias NÃO é reenviado", fora.r.ok === false);
check("vira pedido de 2ª via para o operador", fora.feitos.some((f) => f.o === "pediu 2a via"));
check("e o agente é mandado a não falar valor", fora.r.instruction.includes("NÃO diga valor"));

// reenviar_boleto: boleto cancelado no banco
const cancelado = await chamar(
  "reenviar_boleto",
  { seu_numero: "A801-03/05" },
  { ...CARTAO, parcelas: [{ seuNumero: "A801-03/05", vencimento: "2026-09-14", valor: 6128.57, status: "cancelado" }] }
);
check("boleto cancelado no banco não é reenviado, mesmo estando 'no prazo'", cancelado.r.ok === false);
check("e também vira 2ª via", cancelado.feitos.some((f) => f.o === "pediu 2a via"));

const semParcela = await chamar("reenviar_boleto", { seu_numero: "X" }, { nome: "Fulano", parcelas: [] });
check("cliente sem parcela não recebe promessa de boleto", semParcela.r.ok === false);

// registrar_data_pagamento
const promessa = await chamar("registrar_data_pagamento", { data: "2026-09-18", seu_numero: "A801-04/05" });
check("data prometida é gravada", promessa.r.ok === true && promessa.feitos[0].tipo === "data_prometida");
check("e o agente diz que anotou a data", promessa.r.instruction.includes("2026-09-18"));

check(
  "dentro de 7 dias do vencimento, vira pedido de alteração para o operador",
  promessa.r.pedidoDeAdiamento === true &&
    promessa.feitos.some((f) => f.o === "pediu adiamento")
);
check(
  "e o agente promete o PEDIDO, não o resultado",
  /vai PEDIR/.test(promessa.r.instruction) &&
    promessa.r.instruction.includes("NÃO diga que já está alterado")
);
check(
  "e é proibido de prometer que não terá acréscimo",
  promessa.r.instruction.includes("NÃO prometa que") &&
    promessa.r.instruction.includes("acréscimo")
);

const promessaLonge = await chamar("registrar_data_pagamento", { data: "2026-10-30", seu_numero: "A801-04/05" });
check(
  "promessa depois do prazo do boleto avisa que virá boleto novo",
  promessaLonge.r.instruction.includes("novo")
);
check(
  "e aí NÃO abre pedido de adiamento: o boleto já morreu",
  !promessaLonge.r.pedidoDeAdiamento &&
    !promessaLonge.feitos.some((f) => f.o === "pediu adiamento")
);
check(
  "mas NÃO diz qual será o valor",
  promessaLonge.r.instruction.includes("NÃO diga qual será o valor")
);

const ontem = await chamar("registrar_data_pagamento", { data: "2026-09-10" });
check("data no passado não é aceita como promessa", ontem.r.ok === false);
check("e manda usar a ferramenta certa", ontem.r.instruction.includes("registrar_pagamento_informado"));
const semData = await chamar("registrar_data_pagamento", { data: "semana que vem" });
check("data que não é data não quebra nada", semData.r.ok === false);

// registrar_pagamento_informado — a regra mais delicada das quatro
const jaPaguei = await chamar("registrar_pagamento_informado", { quando: "ontem" });
check("'já paguei' é registrado", jaPaguei.r.ok === true);
check("e nada é dado como baixa", !jaPaguei.feitos.some((f) => f.o === "enviou boleto"));
check(
  "e o agente é proibido de dizer que recebeu",
  jaPaguei.r.instruction.includes('NUNCA diga "recebemos"')
);
check("sem comprovante, ninguém é acordado", !jaPaguei.feitos.some((f) => f.o === "chamou robson"));

// Com comprovante a regra muda, e muda por um motivo concreto: o Diego (Ed. Delta
// 703) pediu para pagar por PIX e mandou o PDF do comprovante. Pagamento fora do
// boleto NÃO aparece no relatório do banco. Se o comprovante morresse na conversa,
// a régua voltaria a cobrar um cliente que pagou — que é o pior erro que este
// agente pode cometer.
const comComprovante = await chamar("registrar_pagamento_informado", {
  quando: "agora",
  seu_numero: "A801-04/05",
  comprovante: true,
});
check("comprovante é registrado como comprovante", comComprovante.r.comprovante === true);
check(
  "e chama uma pessoa para conferir, porque o relatório pode nunca mostrar",
  comComprovante.feitos.some((f) => f.o === "chamou robson")
);
check(
  "o recado diz o que fazer, não só que chegou",
  /dar baixa à mão/.test(comComprovante.feitos.find((f) => f.o === "chamou robson").motivo)
);
check(
  "mas o agente continua proibido de confirmar o pagamento",
  comComprovante.r.instruction.includes('NUNCA diga "recebemos"') &&
    !/está pago|recebemos o/i.test(comComprovante.r.instruction.split("NUNCA")[0])
);
check(
  "e a gravação guarda que havia comprovante",
  comComprovante.feitos.find((f) => f.o === "gravou").comprovante === true
);

// chamar_operador
const socorro = await chamar("chamar_operador", { motivo: "quer desconto", urgencia: "normal" });
check("chamar_operador avisa a pessoa", socorro.feitos.some((f) => f.o === "chamou robson"));
check("com o motivo nas palavras do cliente", socorro.feitos[0].motivo === "quer desconto");
check("e leva o contrato junto", socorro.feitos[0].contrato === "A801");
check(
  "e o agente para de cobrar",
  socorro.r.instruction.includes("não cobre mais este cliente")
);
const urgente = await chamar("chamar_operador", { motivo: "falou em advogado", urgencia: "agora" });
check("urgência passa adiante", urgente.feitos[0].urgencia === "agora");
const semUrgencia = await chamar("chamar_operador", { motivo: "x", urgencia: "qualquer coisa" });
check("urgência inventada vira normal", semUrgencia.feitos[0].urgencia === "normal");

// A descrição da ferramenta é o que o modelo lê na hora de decidir. Se os casos
// novos só existissem no prompt, o modelo poderia reconhecer a situação e mesmo
// assim não achar a ferramenta certa.
const descrChamar = toolDefinitions.find((t) => t.name === "chamar_operador").description;
check("a ferramenta lista PIX entre os motivos", /PIX/.test(descrChamar));
check("e notificação extrajudicial também", /extrajudicial/.test(descrChamar));
const descrUrgencia = toolDefinitions.find((t) => t.name === "chamar_operador").input_schema
  .properties.urgencia.description;
check("e 'agora' cobre extrajudicial e desespero", /extrajudicial/.test(descrUrgencia) && /desespero/.test(descrUrgencia));

// Nenhuma instrução de ferramenta ensina o agente a ser cafona
for (const t of toolDefinitions) {
  check(`a descrição de ${t.name} não tem expressão cafona`, expressoesCafonas(t.description).length === 0);
}

check("ferramenta desconhecida não quebra", (await chamar("voar", {})).r.ok === false);

encerrar();
