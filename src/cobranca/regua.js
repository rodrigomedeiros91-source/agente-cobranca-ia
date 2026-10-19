/**
 * A régua: quem recebe o quê, hoje.
 *
 * Função pura. Entram as parcelas, o estado de cada contrato e o relógio; sai a
 * lista de mensagens do dia e a lista de coisas para o operador. Nada de rede,
 * nada de planilha, nenhum `new Date()` escondido lá dentro — o relógio é
 * injetado, e é por isso que dá para testar o sábado às 20h01 sem esperar
 * sábado.
 *
 * O CALENDÁRIO
 *
 *   5 dias antes   o boleto do mês, mais os atrasados reemitidos
 *   no dia         lembrete curto
 *   2, 4 e 6 dias  "venceu dia X; o boleto continua valendo até o dia X+7"
 *   8 dias depois  vira pedido de 2ª via na lista do operador — o agente PARA
 *   10 a 28 dias   de 2 em 2, SEM valor: o boleto já não vale
 *   30/60/90 dias  só aviso interno; no de 90 vai o botão "passar para o dono"
 *
 * OS FREIOS
 *
 * No máximo uma mensagem por cliente por dia. Das 8h às 20h, de segunda a
 * sábado. "Já paguei" pausa até o próximo relatório. Data prometida silencia
 * até o dia seguinte a ela. Cliente entregue ao operador fica parado até ele
 * liberar. E antes de qualquer cobrança, o cliente precisa ter dito que é ele.
 *
 * Isso não é educação, é sobrevivência: o CDC proíbe constranger quem deve, e
 * o WhatsApp bloqueia número que insiste. Um agente que manda três mensagens
 * por dia perde o número da empresa na primeira semana.
 *
 * DEPOIS DE 8 DIAS O AGENTE CALA A BOCA
 *
 * A partir daí só o operador fala, porque só ele pode emitir o boleto novo. O
 * agente não manda valor sem boleto — valor sem boleto vira discussão, e
 * discussão sobre dinheiro com robô é como se perde cliente.
 *
 * O HORÁRIO VEM PRONTO
 *
 * `agora` chega como "AAAA-MM-DDTHH:MM" já no horário de Brasília. O módulo lê
 * os pedaços como texto e não faz conta de fuso. O servidor roda em UTC; se a
 * régua fizesse a conversão sozinha, um erro de fuso mandaria mensagem às 5h
 * da manhã e ninguém descobriria até o cliente reclamar.
 */

import { apresentacaoPara } from "./mensagens.js";

/** Um dia em milissegundos. Datas ancoradas ao meio-dia, para o horário de verão não mexer no resultado. */
const DIA = 86400000;
const meioDia = (iso) => new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).getTime();

/** Dias entre duas datas. Positivo = a segunda é depois. */
export function diasEntre(de, ate) {
  return Math.round((meioDia(ate) - meioDia(de)) / DIA);
}

export function somarDias(iso, dias) {
  return new Date(meioDia(iso) + dias * DIA).toISOString().slice(0, 10);
}

/** 0 = domingo. */
const diaDaSemana = (iso) => new Date(meioDia(iso)).getUTCDay();

/**
 * Das 8h às 20h, de segunda a sábado.
 *
 * Domingo não. Não é regra de lei: é que cobrança no domingo é o tipo de coisa
 * que faz o cliente bloquear o número, e um número bloqueado não cobra ninguém.
 */
export function horarioDeFalar(agora) {
  const data = String(agora).slice(0, 10);
  const hora = Number(String(agora).slice(11, 13));
  const dia = diaDaSemana(data);
  if (dia === 0) return { pode: false, motivo: "domingo" };
  if (hora < 8) return { pode: false, motivo: "antes das 8h" };
  if (hora >= 20) return { pode: false, motivo: "depois das 20h" };
  return { pode: true };
}

/**
 * De quantos em quantos dias o atrasado é cobrado, e a partir de quando.
 *
 * O operador respondeu isso em 28/09/2026, e a resposta dele substituiu o
 * palpite anterior (terça e sexta, que fui eu que escolhi):
 *
 *   "Pode ser a partir de 2 dias após o vencimento do boleto atrasado e
 *    continuar de 2 em 2 dias se for possível. Caso não consiga podemos fazer
 *    como sugerido as terças e sextas feiras."
 *
 * É possível, então é de 2 em 2 dias. A alternativa de terça e sexta saiu do
 * código: opção que ninguém vai usar é código morto esperando confundir alguém.
 *
 * O resultado prático é uma cobrança MAIS frequente que a anterior nos
 * primeiros dias e igual depois. O freio continua sendo o mesmo de sempre: uma
 * mensagem por cliente por dia, nada aos domingos, e nada depois do 30º dia.
 */
export const PRIMEIRO_DIA_DE_COBRANCA = 2;
export const PASSO_DE_COBRANCA = 2;

/** Depois disto o agente não fala mais: o caso é do operador e do jurídico. */
const ULTIMO_DIA_DE_COBRANCA = 30;

/**
 * O que a régua tem a dizer sobre UMA parcela hoje.
 *
 * Devolve `null` quando não é dia de falar dela. `interno: true` quer dizer
 * que é recado para o operador, não mensagem para o cliente.
 *
 * DO 9º AO 30º DIA O AGENTE FALA SEM DIZER VALOR
 *
 * A partir do 8º dia o boleto não vale mais, e o agente não manda valor sem
 * boleto — valor sem boleto vira discussão, e discussão sobre dinheiro com
 * robô é como se perde cliente. Mas a reunião pediu cobrança até os 30 dias.
 *
 * A saída é o evento `em_aberto`: ele lembra que a parcela do mês continua em
 * aberto e que a segunda via foi pedida, **sem número nenhum**. Um teste
 * garante que nenhuma mensagem depois do 8º dia carregue valor.
 */
export function eventoDaParcela({ vencimento, status = "enviado", hoje }) {
  if (["pago", "cancelado", "pausado"].includes(status)) return null;

  const dias = diasEntre(vencimento, hoje); // negativo = ainda vai vencer

  if (dias === -5) return { tipo: "boleto", modelo: "cobranca_boleto" };
  if (dias === 0) return { tipo: "lembrete", modelo: "cobranca_lembrete" };
  if (dias === 8) return { tipo: "segunda_via", interno: true };

  if (dias === 30 || dias === 60 || dias === 90) {
    return { tipo: `aviso_${dias}`, interno: true, botao: dias === 90 ? "Passar para o dono" : null };
  }

  // De 2 em 2 dias a partir do 2º. O 8º é pulado porque já é o recado interno
  // da 2ª via, e nesse dia o agente cala a boca por definição.
  const noPasso =
    dias >= PRIMEIRO_DIA_DE_COBRANCA &&
    dias < ULTIMO_DIA_DE_COBRANCA &&
    (dias - PRIMEIRO_DIA_DE_COBRANCA) % PASSO_DE_COBRANCA === 0;

  if (noPasso) {
    // Até o 7º dia o boleto ainda vale, então a cobrança pode levar o valor e
    // o código do boleto. Do 8º em diante não existe mais boleto válido, e
    // valor sem boleto vira discussão.
    return dias <= 7
      ? { tipo: "venceu", modelo: "cobranca_atraso" }
      : { tipo: "em_aberto", modelo: "cobranca_em_aberto", semValor: true };
  }

  return null;
}

/**
 * Por que este contrato está calado hoje. `null` = pode falar.
 *
 * A ordem importa: o que trava mais forte vem primeiro, para o motivo que sai
 * no painel ser o motivo de verdade e não o primeiro que casou.
 */
export function porQueEstaCalado({ estado = {}, hoje }) {
  if (estado.comoperador) return "o contrato está com o operador";
  if (estado.pausadoAte && hoje <= estado.pausadoAte) {
    return `pausado até ${estado.pausadoAte}`;
  }
  if (estado.prometidoPara && hoje <= estado.prometidoPara) {
    return `o cliente prometeu pagar em ${estado.prometidoPara}`;
  }
  if (estado.disseQuePagou) return "o cliente disse que pagou; espera o próximo relatório";
  if (estado.ultimaMensagemEm === hoje) return "já falou com este cliente hoje";
  return null;
}

/** Quanto mais atrasada a parcela, mais cedo ela é tratada. */
const PESO = { em_aberto: 0, venceu: 1, lembrete: 2, boleto: 3 };

/**
 * A fila do dia.
 *
 * @param {string} agora - "AAAA-MM-DDTHH:MM", horário de Brasília
 * @param {object[]} contratos - { chave, nome, telefone, situacao }
 * @param {object[]} parcelas - { contrato, seuNumero, vencimento, status, valor }
 * @param {Map<string,object>} estados - por contrato
 * @returns {{ mensagens, interno, calados, horario }}
 */
export function filaDoDia({ agora, contratos = [], parcelas = [], estados = new Map() } = {}) {
  const hoje = String(agora).slice(0, 10);
  const horario = horarioDeFalar(agora);

  const mensagens = [];
  const interno = [];
  const calados = [];

  const porContrato = new Map();
  for (const parcela of parcelas) {
    const lista = porContrato.get(parcela.contrato) || [];
    lista.push(parcela);
    porContrato.set(parcela.contrato, lista);
  }

  for (const contrato of contratos) {
    const minhas = porContrato.get(contrato.chave) || [];
    const estado = estados.get(contrato.chave) || {};

    // Os recados do operador saem mesmo com o cliente pausado ou fora de hora:
    // eles não vão para o cliente, e segurá-los só esconderia problema.
    for (const parcela of minhas) {
      const evento = eventoDaParcela({ ...parcela, hoje });
      if (evento?.interno) {
        interno.push({ contrato: contrato.chave, nome: contrato.nome, ...evento, parcela });
      }
    }

    if (contrato.situacao && contrato.situacao !== "ativo") {
      calados.push({ contrato: contrato.chave, motivo: `contrato ${contrato.situacao}` });
      continue;
    }

    const calado = porQueEstaCalado({ estado, hoje });
    if (calado) {
      calados.push({ contrato: contrato.chave, motivo: calado });
      continue;
    }

    if (!contrato.telefone) {
      calados.push({ contrato: contrato.chave, motivo: "não tem telefone" });
      continue;
    }

    // Antes de cobrar, o cliente precisa ter dito que é ele. Sem isso a
    // empresa estaria mandando dado de dívida para um número que pode ser de
    // qualquer pessoa — e o CDC não perdoa isso.
    if (!estado.confirmouQueEEle) {
      const apresentacao = apresentacaoPara({ nome: contrato.nome, imovel: contrato.imovel });
      mensagens.push({
        contrato: contrato.chave,
        nome: contrato.nome,
        telefone: contrato.telefone,
        tipo: "apresentacao",
        modelo: apresentacao.modelo,
        texto: apresentacao.texto,
        opcoes: apresentacao.opcoes,
        // Vazio de propósito: quem não confirmou quem é não recebe valor.
        parcelas: [],
        porque: estado.apresentadoEm
          ? "ainda não respondeu quem é"
          : "primeira vez que a empresa fala neste número",
      });
      continue;
    }

    const eventos = minhas
      .map((parcela) => ({ parcela, evento: eventoDaParcela({ ...parcela, hoje }) }))
      .filter((x) => x.evento && !x.evento.interno);

    if (!eventos.length) {
      calados.push({ contrato: contrato.chave, motivo: "nada a dizer hoje" });
      continue;
    }

    // Uma mensagem por cliente por dia. Se hoje bate lembrete de uma parcela e
    // aviso de vencimento de outra, vale a mais atrasada — e os boletos do dia
    // viajam juntos, cada um no seu PDF.
    eventos.sort((a, b) => PESO[a.evento.tipo] - PESO[b.evento.tipo]);
    const escolhido = eventos[0];
    const juntas =
      escolhido.evento.tipo === "boleto"
        ? eventos.filter((x) => x.evento.tipo === "boleto").map((x) => x.parcela)
        : [escolhido.parcela];

    mensagens.push({
      contrato: contrato.chave,
      nome: contrato.nome,
      telefone: contrato.telefone,
      tipo: escolhido.evento.tipo,
      modelo: escolhido.evento.modelo,
      parcelas: juntas,
      porque:
        eventos.length > 1
          ? `${eventos.length} coisas hoje; vale a mais atrasada`
          : "o calendário do contrato",
    });
  }

  // Fora de hora nada sai para o cliente, mas a fila fica montada: quando der
  // 8h da manhã é só mandar, sem recalcular nada.
  return { mensagens, interno, calados, horario, segura: !horario.pode };
}

/**
 * O prazo em que o boleto vencido ainda serve.
 *
 * Devolve FATO, não frase pronta. Quem chama é que monta a fala, porque o
 * mesmo prazo significa coisas diferentes em situações diferentes:
 *
 *   o cliente pediu a 2ª via   -> "o boleto vence dia X e ainda está valendo"
 *   o cliente pediu para adiar -> "vou pedir para mudarem a data"
 *
 * Na primeira versão isto devolvia uma frase só, e a frase de adiamento vazava
 * para quem tinha só pedido o boleto de volta — o agente oferecia mudar a data
 * para quem não pediu nada disso.
 *
 * `podeAdiar` vem da resposta do operador em 18/09/2026:
 *
 *   "Se o boleto já estiver sido emitido anteriormente e o cliente pedir o
 *    adiamento, corrigimos o boleto emitido no app do banco com a data de até
 *    7 dias sem acréscimo de valor."
 *
 * Ou seja: o "sem acréscimo" existe, mas depende de **o operador alterar o
 * boleto no banco**. O agente não altera nada, então nunca promete o
 * resultado — só o pedido.
 */
export function aindaDaParaPagar({ vencimento, hoje }) {
  const dias = diasEntre(vencimento, hoje);

  if (dias <= 0) {
    return { vale: true, podeAdiar: true, ate: somarDias(vencimento, 7), texto: "o boleto está em dia" };
  }

  if (dias <= 7) {
    const ate = somarDias(vencimento, 7);
    return {
      vale: true,
      podeAdiar: true,
      ate,
      texto: `Este boleto venceu dia ${vencimento} e ainda está valendo.`,
    };
  }

  return {
    vale: false,
    podeAdiar: false,
    texto: "Passou do prazo deste boleto. Vou pedir a segunda via e te mando assim que sair.",
  };
}
