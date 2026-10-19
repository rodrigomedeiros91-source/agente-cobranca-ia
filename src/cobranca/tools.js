/**
 * As quatro ferramentas da conversa de cobrança.
 *
 * São quatro, e são poucas de propósito. Cobrança é a conversa mais fácil de
 * estragar que existe: do outro lado tem gente devendo dinheiro, às vezes
 * envergonhada, às vezes com raiva, às vezes sem ter mesmo. Quanto menos coisa
 * o agente puder fazer, menos coisa ele pode fazer de errado.
 *
 * O QUE NENHUMA DELAS FAZ
 *
 * Nenhuma calcula valor. Nenhuma dá desconto. Nenhuma muda vencimento. Nenhuma
 * confirma pagamento. O agente só repassa o que a planilha e o banco dizem, e
 * quando o assunto sai disso ele chama o operador.
 *
 * "REGISTRAR" NÃO É "DAR BAIXA"
 *
 * `registrar_pagamento_informado` existe porque o cliente diz "já paguei" e o
 * agente precisa parar de cobrar sem mentir que recebeu. Ela pausa a régua até
 * o próximo relatório do banco — e só o relatório dá baixa. Se o cliente
 * estiver enganado, a cobrança volta sozinha, sem ninguém ter afirmado nada.
 *
 * AS TRAVAS SÃO DAS FERRAMENTAS, NÃO DO PROMPT
 *
 * `reenviar_boleto` confere sozinha se o boleto ainda vale. Não adianta o
 * modelo se convencer de que vale: a ferramenta recusa e devolve o motivo.
 * Regra que mora só no prompt é sugestão; regra que mora no código é regra.
 */

import { aindaDaParaPagar, diasEntre } from "./regua.js";

export const toolDefinitions = [
  {
    name: "reenviar_boleto",
    description:
      "Manda de novo o PDF de um boleto que o cliente já recebeu. Use quando ele disser que " +
      "não achou, apagou, não chegou, ou pedir a segunda via. A ferramenta confere sozinha se " +
      "o boleto ainda está válido: se recusar, NÃO insista e NÃO mande valor nenhum — ela já " +
      "transforma o pedido em trabalho para o operador e te diz o que falar.",
    input_schema: {
      type: "object",
      properties: {
        seu_numero: {
          type: "string",
          description:
            "O código do boleto, como aparece no cartão do cliente (ex.: A801-04/05). " +
            "Se o cliente não disse qual, use o mais antigo em aberto.",
        },
      },
      required: ["seu_numero"],
    },
  },
  {
    name: "registrar_data_pagamento",
    description:
      "Grava o dia em que o cliente disse que vai pagar, e silencia a cobrança até lá. Use " +
      "SEMPRE que ele der uma data, mesmo que seja daqui a semanas. Não negocie a data e não " +
      "diga se é cedo ou tarde: só registre. A ferramenta te devolve o que dizer sobre o " +
      "boleto continuar valendo ou não.",
    input_schema: {
      type: "object",
      properties: {
        data: { type: "string", description: "A data prometida, no formato AAAA-MM-DD." },
        seu_numero: { type: "string", description: "O boleto a que a promessa se refere." },
      },
      required: ["data"],
    },
  },
  {
    name: "registrar_pagamento_informado",
    description:
      'Use quando o cliente disser que JÁ pagou. Ela pausa a cobrança até o próximo relatório ' +
      "do banco. Ela NÃO dá baixa e NÃO confirma nada: quem confirma é o relatório. Nunca " +
      'responda "recebemos" ou "está pago" — você não tem como saber. Se ele mandou ' +
      "comprovante (foto ou PDF), marque comprovante: true — é o que leva o arquivo para uma " +
      "pessoa conferir.",
    input_schema: {
      type: "object",
      properties: {
        quando: {
          type: "string",
          description: "Quando ele disse que pagou, com as palavras dele ('ontem', '05/09').",
        },
        seu_numero: { type: "string", description: "O boleto que ele diz ter pago, se disser." },
        comprovante: {
          type: "boolean",
          description:
            "true se ele mandou comprovante em foto ou PDF nesta conversa. Não tente ler o " +
            "arquivo: só marque.",
        },
      },
      required: ["quando"],
    },
  },
  {
    name: "chamar_operador",
    description:
      "Entrega a conversa para uma pessoa e PARA de cobrar este cliente até ela liberar. Use " +
      "para: desconto, abatimento, contestação de valor, renegociação, quitar ou juntar " +
      "boletos, pedido de pagar por PIX, transferência ou cartão, notificação extrajudicial, " +
      "dificuldade financeira séria, doença ou morte na família, advogado, ameaça, " +
      "pedido de falar com alguém, e qualquer assunto que não seja cobrança. Na dúvida, chame. " +
      "Chamar à toa custa um recado; não chamar na hora custa o cliente.",
    input_schema: {
      type: "object",
      properties: {
        motivo: {
          type: "string",
          description:
            "Uma linha sobre o que o cliente quer, com as palavras dele. Vai inteiro para o operador.",
        },
        urgencia: {
          type: "string",
          enum: ["normal", "agora"],
          description:
            "'agora' para ameaça, advogado, notificação extrajudicial, doença ou morte na " +
            "família, e para quem escreve em desespero. 'normal' para o resto.",
        },
      },
      required: ["motivo"],
    },
  },
];

export function toolsAtivas() {
  return toolDefinitions;
}

const IDIOMA = "Responda em português do Brasil, em uma ou duas frases.";

/**
 * Roda uma ferramenta.
 *
 * Os efeitos entram por `contexto` — gravar na planilha, mandar o PDF, avisar o
 * operador. Assim o teste roda a decisão inteira sem planilha e sem WhatsApp, que
 * é o único jeito de testar a regra do boleto vencido cem vezes por segundo.
 *
 * @param {object} contexto.cartao  - os dados DAQUELE cliente (ver prompt.js)
 * @param {string} contexto.hoje    - AAAA-MM-DD
 * @param {object} contexto.efeitos - { enviarBoleto, pedirSegundaVia, gravar, avisaroperador }
 */
export async function runTool(nome, entrada = {}, telefone, contexto = {}) {
  const { cartao = {}, hoje = "", efeitos = {} } = contexto;
  const parcelas = cartao.parcelas || [];
  const achar = (seuNumero) =>
    parcelas.find(
      (p) => String(p.seuNumero).toUpperCase() === String(seuNumero || "").toUpperCase()
    );

  if (nome === "reenviar_boleto") {
    const parcela = achar(entrada.seu_numero) || parcelas[0];

    if (!parcela) {
      return JSON.stringify({
        ok: false,
        instruction:
          IDIOMA +
          " Este cliente não tem boleto em aberto agora. Diga isso e não prometa mandar nada.",
      });
    }

    // A parcela cancelada é o boleto que o banco baixou. Ele não serve mais
    // nem que o cliente queira pagar: o código já não existe no banco.
    if (parcela.status === "cancelado") {
      await efeitos.pedirSegundaVia?.({ parcela, motivo: "boleto cancelado no banco" });
      return JSON.stringify({
        ok: false,
        instruction:
          IDIOMA +
          " Este boleto foi cancelado no banco e não serve mais. Já pedi a segunda via ao" +
          " responsável. Diga que vai chegar em breve. NÃO diga valor nenhum.",
      });
    }

    const prazo = aindaDaParaPagar({ vencimento: parcela.vencimento, hoje });
    if (!prazo.vale) {
      await efeitos.pedirSegundaVia?.({ parcela, motivo: "passou de 7 dias do vencimento" });
      return JSON.stringify({
        ok: false,
        instruction: IDIOMA + " " + prazo.texto + " NÃO diga valor nenhum, nem estimativa.",
      });
    }

    await efeitos.enviarBoleto?.({ parcela, telefone });
    return JSON.stringify({
      ok: true,
      seu_numero: parcela.seuNumero,
      vencimento: parcela.vencimento,
      instruction: IDIOMA + " Avise que o boleto está indo. " + prazo.texto,
    });
  }

  if (nome === "registrar_data_pagamento") {
    const data = String(entrada.data || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      return JSON.stringify({
        ok: false,
        instruction: IDIOMA + " Não entendi a data. Pergunte o dia, sem insistir.",
      });
    }
    if (diasEntre(hoje, data) < 0) {
      return JSON.stringify({
        ok: false,
        instruction:
          IDIOMA +
          " Essa data já passou. Se ele quis dizer que JÁ pagou, use registrar_pagamento_informado.",
      });
    }

    const parcela = achar(entrada.seu_numero) || parcelas[0];
    await efeitos.gravar?.({ tipo: "data_prometida", data, parcela, telefone });

    const prazo = parcela ? aindaDaParaPagar({ vencimento: parcela.vencimento, hoje: data }) : null;

    // Até 7 dias do vencimento, o operador consegue mudar a data no app do banco
    // e aí não tem acréscimo. Mas quem muda é ele: o agente abre o pedido e
    // promete o PEDIDO, nunca o resultado. Se prometesse a isenção e o operador
    // não alterasse a tempo, o cliente pagaria multa depois de ter sido
    // avisado de que não pagaria — e a culpa seria da empresa.
    if (prazo?.podeAdiar) {
      await efeitos.pedirAdiamento?.({ parcela, data, telefone });
      return JSON.stringify({
        ok: true,
        data,
        pedidoDeAdiamento: true,
        instruction:
          IDIOMA +
          ` Confirme que anotou para ${data} e diga que vai PEDIR para mudarem a data do boleto,` +
          ` e que avisa assim que estiver feito. NÃO diga que já está alterado e NÃO prometa que` +
          ` não haverá acréscimo — quem altera é a equipe, não você.`,
      });
    }

    return JSON.stringify({
      ok: true,
      data,
      instruction:
        IDIOMA +
        ` Confirme que anotou para ${data} e que não vai cobrar até lá. ` +
        (prazo
          ? "Avise que, nessa data, este boleto já terá passado do prazo e vai precisar de um" +
            " novo. NÃO diga qual será o valor."
          : ""),
    });
  }

  if (nome === "registrar_pagamento_informado") {
    const parcela = achar(entrada.seu_numero);
    const comprovante = entrada.comprovante === true;

    await efeitos.gravar?.({
      tipo: "pagamento_informado",
      quando: entrada.quando,
      comprovante,
      parcela,
      telefone,
    });

    // Comprovante não é "já paguei". "Já paguei" espera o relatório do banco
    // resolver sozinho; o comprovante é justamente o caso em que o relatório
    // pode nunca resolver — quem paga por PIX ou transferência não aparece no
    // arquivo de boletos, e a régua voltaria a cobrar quem acabou de pagar.
    // Então o arquivo vira trabalho de gente, na hora.
    if (comprovante) {
      await efeitos.avisaroperador?.({
        motivo: `Mandou comprovante (${entrada.quando}). Conferir e dar baixa à mão se não vier no relatório.`,
        urgencia: "normal",
        telefone,
        cliente: cartao.nome,
        contrato: cartao.contrato,
      });
    }

    return JSON.stringify({
      ok: true,
      comprovante,
      instruction:
        IDIOMA +
        (comprovante
          ? " Agradeça pelo comprovante e diga que uma pessoa vai conferir."
          : " Agradeça e diga que vai conferir com o banco e só volta a falar se faltar alguma coisa.") +
        ' NUNCA diga "recebemos", "está pago" ou "baixado": quem confirma é o relatório do banco.',
    });
  }

  if (nome === "chamar_operador") {
    await efeitos.avisaroperador?.({
      motivo: entrada.motivo,
      urgencia: entrada.urgencia === "agora" ? "agora" : "normal",
      telefone,
      cliente: cartao.nome,
      contrato: cartao.contrato,
    });
    return JSON.stringify({
      ok: true,
      instruction:
        IDIOMA +
        " Diga que passou para a pessoa responsável e que ela retorna. A partir de agora não" +
        " cobre mais este cliente e não opine sobre o que ele pediu.",
    });
  }

  return JSON.stringify({ ok: false, instruction: IDIOMA + " Ferramenta desconhecida." });
}
