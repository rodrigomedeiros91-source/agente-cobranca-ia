/**
 * Os textos que saem para o cliente.
 *
 * Moram aqui, e não espalhados pelo código, por dois motivos. Um: são eles que
 * viram modelo aprovado pela Meta, e modelo aprovado não pode divergir do que
 * o sistema manda — se divergir, a Meta reprova ou bloqueia. Dois: o dono e
 * o operador precisam ler e aprovar palavra por palavra, e ninguém revisa texto
 * que está no meio de uma função.
 *
 * A APRESENTAÇÃO É OBRIGATÓRIA, E VEM ANTES DE TUDO
 *
 * Decidido na reunião de 18/09/2026: o cliente precisa saber que quem responde
 * é um assistente automático. Isso não é cortesia — é transparência, e a LGPD
 * pede clareza sobre o tratamento dos dados dele.
 *
 * E ela protege a empresa de um jeito prático: o número é novo, e ninguém sabe
 * de quem é. Mandar valor de dívida para um número não confirmado é mandar
 * dado de dívida para quem pode ser qualquer pessoa. Por isso esta mensagem
 * NÃO leva valor, NÃO leva o código do boleto e NÃO diz que existe parcela em
 * aberto: ela só pergunta se é a pessoa certa. A régua só libera cobrança
 * depois do "sou eu".
 */

/** Troca {chave} pelo valor. Chave sem valor some, em vez de virar "undefined". */
export function montar(modelo, dados = {}) {
  return String(modelo).replace(/\{(\w+)\}/g, (_, chave) =>
    dados[chave] === undefined || dados[chave] === null ? "" : String(dados[chave])
  );
}

export const APRESENTACAO = `Olá, {nome}. Este é o novo WhatsApp oficial da {empresa} para assuntos do seu contrato do {imovel}.

Quem responde por aqui é um assistente automático, e uma pessoa da equipe acompanha e entra na conversa quando precisa. Por aqui você recebe o boleto do mês, tira dúvida sobre a parcela e pede segunda via.

Seus dados são usados só para o seu contrato. Se quiser saber quais temos ou corrigir algum, é só pedir.

Confirmo que estou falando com {nome}?`;

/** Os botões da apresentação. Sem "Sou eu", a régua não libera cobrança. */
export const APRESENTACAO_OPCOES = ["Sou eu", "Número errado"];

export const NOME_DA_EMPRESA = (process.env.COBRANCA_EMPRESA || "Imobiliária Exemplo").trim();

/** A apresentação pronta para um cliente. */
export function apresentacaoPara({ nome, imovel, empresa = NOME_DA_EMPRESA }) {
  return {
    texto: montar(APRESENTACAO, { nome, imovel, empresa }),
    opcoes: APRESENTACAO_OPCOES,
    modelo: "cobranca_apresentacao",
  };
}
